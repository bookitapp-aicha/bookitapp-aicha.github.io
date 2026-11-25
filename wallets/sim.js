/* Wallet & Gift Cards — in-browser model of the proposed backend.
 * One in-memory "database" plus the handlers the real API would expose.
 * Every handler runs like a DB transaction: if it throws, all changes roll back.
 * Sample data only. Nothing here talks to a server. */
(function (root) {
  'use strict';

  const DAY = 86400000;
  const BIZ = 'biz_nileflow';
  const CUR = 'EGP';
  const r2 = (x) => Math.round(x * 100) / 100;

  function create() {
    const S = {
      now: Date.UTC(2026, 10, 25, 8, 0, 0), // 25 Nov 2026, 10:00 in Cairo
      tick: 0,
      log: [],
      counters: {},
      db: {
        BusinessWalletConfigs: [],
        Users: [],
        GiftCardOrders: [],
        GiftCards: [],
        WalletLedgers: [],
        WalletLedgerAllocations: [],
        PaymentTransactions: [],
        PaymentRefunds: [],
        Bookings: [],
        ClientPackages: [],
      },
      services: [
        { id: 'svc_vinyasa', kind: 'class_booking', title: 'Vinyasa Flow', meta: 'Class · 60 min', price: 350 },
        { id: 'svc_reformer', kind: 'class_booking', title: 'Reformer Pilates', meta: 'Class · 50 min', price: 450 },
        { id: 'svc_massage', kind: 'appointment', title: 'Deep Tissue Massage', meta: 'Appointment · 60 min', price: 900 },
        { id: 'svc_pass', kind: 'package', title: '10-class pass', meta: 'Package · 10 sessions', price: 3000 },
      ],
    };
    let touched = null;
    let effects = null;

    /* ---------- tiny storage helpers ---------- */
    const nextId = (p) => {
      S.counters[p] = (S.counters[p] || 0) + 1;
      return p + '_' + String(S.counters[p]).padStart(3, '0');
    };
    const ins = (table, row) => {
      row._t = S.tick;
      S.db[table].push(row);
      if (touched) touched.add(table);
      return row;
    };
    const upd = (table, row, patch) => {
      Object.assign(row, patch);
      row._t = S.tick;
      if (touched) touched.add(table);
      return row;
    };
    const fail = (status, message) => {
      throw { status, message };
    };
    const say = (text) => {
      if (effects) effects.push(text);
    };
    const cfg = () => S.db.BusinessWalletConfigs[0];
    const user = (id) => S.db.Users.find((u) => u.id === id);
    const service = (id) => S.services.find((s) => s.id === id);
    const addMonths = (ts, n) => {
      const d = new Date(ts);
      d.setUTCMonth(d.getUTCMonth() + n);
      return d.getTime();
    };

    /* ---------- phone is the identity of a gift card ---------- */
    function toE164(raw) {
      let p = String(raw || '').replace(/[\s\-().]/g, '');
      if (p.startsWith('00')) p = '+' + p.slice(2);
      else if (p.startsWith('0')) p = '+20' + p.slice(1);
      else if (!p.startsWith('+')) p = '+' + p;
      return /^\+\d{10,15}$/.test(p) ? p : null;
    }
    const clientByPhone = (phone) => S.db.Users.find((u) => u.phone === phone && u.role === 'user');

    /* Deterministic, human-readable gift card ID. */
    let codeSeed = 20261125;
    function giftCode() {
      const A = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
      let out = 'GC-';
      for (let i = 0; i < 8; i++) {
        codeSeed = (codeSeed * 1103515245 + 12345) % 2147483648;
        out += A[codeSeed % A.length];
        if (i === 3) out += '-';
      }
      return out;
    }
    const txnRef = () => {
      const d = new Date(S.now);
      const ymd = d.getUTCFullYear() + String(d.getUTCMonth() + 1).padStart(2, '0') + String(d.getUTCDate()).padStart(2, '0');
      return 'TXN-' + ymd + '-' + String(1000 + (S.counters.txn || 0) + 1);
    };

    /* ---------- wallet ledger: credits are lots, debits draw from lots ---------- */
    function lots(userId) {
      return S.db.WalletLedgers.filter(
        (e) =>
          e.user_id === userId &&
          e.entry_type === 'credit' &&
          e.status === 'active' &&
          e.remaining_amount > 0 &&
          (!e.expires_at || e.expires_at > S.now)
      ).sort((a, b) => (a.expires_at || Infinity) - (b.expires_at || Infinity) || a.created_at - b.created_at);
    }
    const balance = (userId) => r2(lots(userId).reduce((s, l) => s + l.remaining_amount, 0));

    function credit(o) {
      return ins('WalletLedgers', {
        id: nextId('wl'),
        business_id: BIZ,
        user_id: o.user_id,
        entry_type: 'credit',
        reason: o.reason,
        amount: r2(o.amount),
        remaining_amount: r2(o.amount),
        currency: CUR,
        expires_at: o.expires_at || addMonths(S.now, cfg().credit_expiry_months),
        status: 'active',
        gift_card_id: o.gift_card_id || null,
        source_transaction_id: o.source_transaction_id || null,
        source_refund_id: o.source_refund_id || null,
        reference_type: o.reference_type || null,
        reference_id: o.reference_id || null,
        created_by: o.created_by || null,
        created_at: S.now,
      });
    }

    /* Draw `amount` from the user's lots: earliest expiry first, then oldest. */
    function debit(o) {
      const pool = o.lots || lots(o.user_id);
      const avail = r2(pool.reduce((s, l) => s + l.remaining_amount, 0));
      if (avail + 0.001 < o.amount) fail(409, 'Wallet balance is lower than the amount requested.');
      const e = ins('WalletLedgers', {
        id: nextId('wl'),
        business_id: BIZ,
        user_id: o.user_id,
        entry_type: 'debit',
        reason: o.reason,
        amount: r2(o.amount),
        remaining_amount: null,
        currency: CUR,
        expires_at: null,
        status: o.status || 'posted',
        gift_card_id: null,
        source_transaction_id: null,
        source_refund_id: null,
        reference_type: o.reference_type || null,
        reference_id: o.reference_id || null,
        created_by: o.created_by || null,
        created_at: S.now,
      });
      let left = r2(o.amount);
      for (const lot of pool) {
        if (left <= 0) break;
        const take = Math.min(lot.remaining_amount, left);
        const rem = r2(lot.remaining_amount - take);
        upd('WalletLedgers', lot, { remaining_amount: rem, status: rem === 0 ? o.lotEndStatus || 'consumed' : 'active' });
        ins('WalletLedgerAllocations', {
          id: nextId('wa'),
          debit_entry_id: e.id,
          lot_id: lot.id,
          gift_card_id: lot.gift_card_id,
          amount: r2(take),
          created_at: S.now,
        });
        left = r2(left - take);
      }
      return e;
    }
    const allocationsOf = (debitId) => S.db.WalletLedgerAllocations.filter((a) => a.debit_entry_id === debitId);
    const entry = (id) => S.db.WalletLedgers.find((e) => e.id === id);

    /* A held debit (payment still pending) is released: lots get their money back. */
    function releaseHold(d) {
      for (const a of allocationsOf(d.id)) {
        const lot = entry(a.lot_id);
        upd('WalletLedgers', lot, { remaining_amount: r2(lot.remaining_amount + a.amount), status: 'active' });
      }
      upd('WalletLedgers', d, { status: 'released' });
    }

    /* A posted spend is refunded: each lot it drew from gets a new lot back,
     * keeping the gift card link so the card's history stays whole. */
    function reverseSpend(d, ref) {
      const made = [];
      for (const a of allocationsOf(d.id)) {
        const lot = entry(a.lot_id);
        made.push(
          credit({
            user_id: d.user_id,
            reason: 'spend_reversal',
            amount: a.amount,
            gift_card_id: lot.gift_card_id,
            expires_at: Math.max(lot.expires_at || 0, S.now + 30 * DAY),
            reference_type: ref.type,
            reference_id: ref.id,
            created_by: ref.by || null,
          })
        );
      }
      return made;
    }

    /* ---------- payments ---------- */
    function txn(o) {
      const ref = txnRef();
      S.counters.txn = (S.counters.txn || 0) + 1;
      return ins('PaymentTransactions', {
        id: 'txn_' + String(S.counters.txn).padStart(3, '0'),
        transaction_reference: ref,
        business_id: BIZ,
        user_id: o.user_id,
        booking_type: o.booking_type,
        booking_id: o.booking_id,
        payment_method: o.method,
        amount: r2(o.amount),
        currency: CUR,
        payment_status: o.status,
        payment_gateway: o.method === 'pay_online' ? 'paymob' : null,
        created_at: S.now,
      });
    }
    const txnsOf = (type, id) => S.db.PaymentTransactions.filter((t) => t.booking_type === type && t.booking_id === id);
    const METHOD_LABEL = {
      pay_online: 'Pay online',
      card_at_venue: 'Card at venue',
      cash_instapay_at_venue: 'Cash / InstaPay at venue',
      wallet: 'Wallet',
    };

    function refund(o) {
      return ins('PaymentRefunds', {
        id: nextId('rf'),
        payment_transaction_id: o.txn.id,
        refund_reference: 'REF-' + o.txn.transaction_reference.slice(4),
        original_amount: o.txn.amount,
        refund_amount: r2(o.amount),
        refund_type: r2(o.amount) >= o.txn.amount ? 'full' : 'partial',
        refund_destination: o.destination,
        refund_status: 'completed',
        gateway_refund_id: o.destination === 'original_method' && o.txn.payment_gateway ? 'pmb_rf_' + (8800 + S.db.PaymentRefunds.length) : null,
        wallet_ledger_id: o.wallet_ledger_id || null,
        refund_reason: o.reason || null,
        requested_by: o.by || null,
        created_at: S.now,
      });
    }

    /* ---------- gift cards ---------- */
    function cardLots(card) {
      return S.db.WalletLedgers.filter((e) => e.entry_type === 'credit' && e.gift_card_id === card.id);
    }
    function cardView(card) {
      const all = cardLots(card);
      const live = all.filter((l) => l.status === 'active' && l.remaining_amount > 0 && (!l.expires_at || l.expires_at > S.now));
      const allocs = S.db.WalletLedgerAllocations.filter((a) => a.gift_card_id === card.id);
      const usage = [];
      let spent = 0;
      let expired = 0;
      let voided = card.status === 'voided' && !card.claimed_at ? card.amount : 0;
      for (const a of allocs) {
        const d = entry(a.debit_entry_id);
        if (d.status === 'released') continue;
        if (d.reason === 'spend') {
          spent += a.amount;
          const b = S.db.Bookings.find((x) => x.id === d.reference_id);
          usage.push({ at: d.created_at, label: b ? b.title : 'Booking', kind: d.status === 'held' ? 'Held while paying' : 'Spent', amount: -a.amount });
        } else if (d.reason === 'expiry') {
          expired += a.amount;
          usage.push({ at: d.created_at, label: 'Credit expired', kind: 'Expired', amount: -a.amount });
        } else if (d.reason === 'void') {
          voided += a.amount;
          usage.push({ at: d.created_at, label: 'Gift card voided', kind: 'Voided', amount: -a.amount });
        }
      }
      for (const l of all.filter((x) => x.reason === 'spend_reversal')) {
        spent -= l.amount;
        const b = S.db.Bookings.find((x) => x.id === l.reference_id);
        usage.push({ at: l.created_at, label: (b ? b.title : 'Booking') + ' cancelled', kind: 'Returned', amount: l.amount });
      }
      const remaining = card.status === 'pending_claim' ? card.amount : r2(live.reduce((s, l) => s + l.remaining_amount, 0));
      let state = card.status;
      if (card.status === 'active') state = remaining > 0 ? 'active' : expired > 0 && spent < card.amount ? 'expired' : 'used';
      const sender = user(card.sender_user_id);
      const firstLot = live.slice().sort((a, b) => a.expires_at - b.expires_at)[0];
      return {
        id: card.id,
        code: card.code,
        amount: card.amount,
        currency: CUR,
        used: r2(spent),
        expired: r2(expired),
        voided: r2(voided),
        remaining,
        status: state,
        channel: card.channel,
        sender: { id: sender.id, name: sender.full_name },
        recipient: { id: card.recipient_user_id, name: card.recipient_name, phone: card.recipient_phone },
        created_at: card.created_at,
        claimed_at: card.claimed_at,
        expires_at: firstLot ? firstLot.expires_at : null,
        void_refund_destination: card.void_refund_destination || null,
        usage: usage.sort((a, b) => b.at - a.at),
      };
    }

    function creditFromCard(card, u) {
      credit({ user_id: u.id, reason: 'gift_card', amount: card.amount, gift_card_id: card.id, source_transaction_id: card.payment_transaction_id });
    }

    function issueCard(order, r, senderId) {
      const existing = clientByPhone(r.phone);
      const sender = user(senderId);
      const card = ins('GiftCards', {
        id: nextId('gc'),
        code: giftCode(),
        business_id: BIZ,
        order_id: order.id,
        payment_transaction_id: order.payment_transaction_id,
        amount: order.card_amount,
        currency: CUR,
        recipient_phone: r.phone,
        recipient_name: r.name,
        recipient_email: r.email || null,
        recipient_user_id: existing ? existing.id : null,
        sender_user_id: senderId,
        channel: order.channel,
        status: existing ? 'active' : 'pending_claim',
        claimed_at: existing ? S.now : null,
        voided_at: null,
        voided_by: null,
        void_refund_destination: null,
        void_refund_amount: null,
        created_at: S.now,
      });
      if (existing) creditFromCard(card, existing);
      say(
        'WhatsApp' + (r.email ? ' + email' : '') + ' to ' + r.name + ' (' + r.phone + '): "' + sender.full_name +
          ' sent you a ' + CUR + ' ' + card.amount + ' gift card for Nile Flow Studio. ID ' + card.code + '."' +
          (existing ? '' : ' Includes a sign-up link, because this number has no account yet.')
      );
      return card;
    }

    /* Resolve "pick an existing client or add a new one". Never free text. */
    function resolveClient(x, label) {
      if (!x) fail(422, label + ' is required.');
      if (x.client_id) {
        const u = user(x.client_id);
        if (!u) fail(404, label + ' was not found.');
        if (!u.phone) fail(422, label + ' has no phone number on file. Add one first.');
        return u;
      }
      if (!x.name || !String(x.name).trim()) fail(422, label + ' name is required.');
      const phone = toE164(x.phone);
      if (!phone) fail(422, label + ' needs a valid WhatsApp number.');
      const found = clientByPhone(phone);
      if (found) return found; // same phone means same client
      return ins('Users', {
        id: nextId('usr'),
        full_name: String(x.name).trim(),
        phone,
        email: x.email || null,
        role: 'user',
        phone_verified_at: null,
        created_at: S.now,
      });
    }

    /* ---------- bookings ---------- */
    function finalizeBooking(b, ok) {
      const hold = S.db.WalletLedgers.find((e) => e.entry_type === 'debit' && e.reference_id === b.id && e.status === 'held');
      if (!ok) {
        if (hold) releaseHold(hold);
        upd('Bookings', b, { status: 'failed', payment_state: 'failed' });
        return;
      }
      if (hold) {
        upd('WalletLedgers', hold, { status: 'posted' });
        txn({ user_id: b.user_id, booking_type: b.kind, booking_id: b.id, method: 'wallet', amount: hold.amount, status: 'completed' });
      }
      upd('Bookings', b, { status: 'confirmed', payment_state: 'paid' });
      say('Booking confirmation to ' + user(b.user_id).full_name + ' for ' + b.title + '.');
    }

    function refundBooking(b, opts) {
      const u = user(b.user_id);
      const out = { to_wallet: 0, to_original_method: 0, returned_to_wallet: 0, parts: [] };
      if (b.payment_state === 'covered') {
        const pk = S.db.ClientPackages.find((p) => p.id === b.client_package_id);
        if (pk) upd('ClientPackages', pk, { sessions_remaining: pk.sessions_remaining + 1 });
        out.parts.push({ method: 'package', note: 'Session returned to the package' });
      }
      for (const t of txnsOf(b.kind, b.id).filter((x) => x.payment_status === 'completed')) {
        if (t.payment_method === 'wallet') {
          const d = S.db.WalletLedgers.find((e) => e.entry_type === 'debit' && e.reference_id === b.id && e.status === 'posted' && e.reason === 'spend');
          const made = reverseSpend(d, { type: b.kind, id: b.id, by: opts.by });
          refund({ txn: t, amount: t.amount, destination: 'wallet', wallet_ledger_id: made[0].id, reason: opts.reason, by: opts.by });
          out.returned_to_wallet = r2(out.returned_to_wallet + t.amount);
          out.parts.push({ method: 'wallet', amount: t.amount, destination: 'wallet', note: 'Went back to the same wallet credit it came from' });
        } else if (t.payment_method === 'pay_online') {
          const dest = opts.destination || (cfg().refund_to_wallet_enabled ? 'wallet' : 'original_method');
          if (dest === 'wallet') {
            const rf = refund({ txn: t, amount: t.amount, destination: 'wallet', reason: opts.reason, by: opts.by });
            const c = credit({ user_id: u.id, reason: 'refund', amount: t.amount, source_transaction_id: t.id, source_refund_id: rf.id, reference_type: b.kind, reference_id: b.id, created_by: opts.by });
            upd('PaymentRefunds', rf, { wallet_ledger_id: c.id });
            out.to_wallet = r2(out.to_wallet + t.amount);
            out.parts.push({ method: 'pay_online', amount: t.amount, destination: 'wallet', expires_at: c.expires_at });
          } else {
            refund({ txn: t, amount: t.amount, destination: 'original_method', reason: opts.reason, by: opts.by });
            out.to_original_method = r2(out.to_original_method + t.amount);
            out.parts.push({ method: 'pay_online', amount: t.amount, destination: 'original_method', note: 'Paymob refund to the card' });
          }
        } else {
          // Recorded by an admin at the venue: the wallet setting never applies.
          const dest = opts.destination === 'wallet' ? 'wallet' : 'original_method';
          if (dest === 'wallet') {
            const rf = refund({ txn: t, amount: t.amount, destination: 'wallet', reason: opts.reason, by: opts.by });
            const c = credit({ user_id: u.id, reason: 'refund', amount: t.amount, source_transaction_id: t.id, source_refund_id: rf.id, reference_type: b.kind, reference_id: b.id, created_by: opts.by });
            upd('PaymentRefunds', rf, { wallet_ledger_id: c.id });
            out.to_wallet = r2(out.to_wallet + t.amount);
            out.parts.push({ method: t.payment_method, amount: t.amount, destination: 'wallet', expires_at: c.expires_at });
          } else {
            refund({ txn: t, amount: t.amount, destination: 'original_method', reason: opts.reason, by: opts.by });
            out.to_original_method = r2(out.to_original_method + t.amount);
            out.parts.push({ method: t.payment_method, amount: t.amount, destination: 'original_method', note: 'Handed back at the venue' });
          }
        }
        upd('PaymentTransactions', t, { payment_status: 'refunded' });
      }
      upd('Bookings', b, { status: 'cancelled', payment_state: b.payment_state === 'covered' ? 'covered' : 'refunded' });
      const walletTotal = r2(out.to_wallet + out.returned_to_wallet);
      if (walletTotal > 0) {
        say('WhatsApp to ' + u.full_name + ': "' + CUR + ' ' + walletTotal + ' from your cancelled ' + b.title + ' is in your wallet, not on your card."');
      }
      if (out.to_original_method > 0) say('Cancellation notice to ' + u.full_name + ': ' + CUR + ' ' + out.to_original_method + ' refunded to the original payment method.');
      return out;
    }

    /* ---------- views used by both apps ---------- */
    function walletView(userId) {
      const ls = lots(userId);
      const cards = S.db.GiftCards.filter((c) => c.recipient_user_id === userId).map(cardView).sort((a, b) => b.created_at - a.created_at);
      const activity = S.db.WalletLedgers.filter((e) => e.user_id === userId && e.status !== 'released')
        .map((e) => {
          const card = e.gift_card_id ? S.db.GiftCards.find((c) => c.id === e.gift_card_id) : null;
          const b = e.reference_id ? S.db.Bookings.find((x) => x.id === e.reference_id) : null;
          let label = '';
          if (e.entry_type === 'credit') {
            if (e.reason === 'gift_card') label = 'Gift card from ' + user(card.sender_user_id).full_name;
            else if (e.reason === 'refund') label = b ? 'Refund: ' + b.title : 'Refund: voided gift card';
            else if (e.reason === 'spend_reversal') label = 'Returned: ' + (b ? b.title : 'booking') + ' cancelled';
            else label = 'Credit';
          } else if (e.reason === 'spend') label = (b ? b.title : 'Booking') + (e.status === 'held' ? ' (held)' : '');
          else if (e.reason === 'expiry') label = 'Credit expired';
          else if (e.reason === 'void') label = 'Gift card voided';
          return { id: e.id, at: e.created_at, label, amount: e.entry_type === 'credit' ? e.amount : -e.amount, expires_at: e.entry_type === 'credit' ? e.expires_at : null };
        })
        .sort((a, b) => b.at - a.at || (a.id < b.id ? 1 : -1));
      return {
        balance: balance(userId),
        currency: CUR,
        next_expiry: ls[0] ? { amount: ls[0].remaining_amount, expires_at: ls[0].expires_at } : null,
        credits: ls.map((l) => ({ id: l.id, reason: l.reason, remaining: l.remaining_amount, expires_at: l.expires_at, gift_card_id: l.gift_card_id })),
        gift_cards: cards,
        activity,
      };
    }

    /* ---------- the API surface ---------- */
    const H = {
      /* ===== client app ===== */
      'client.wallet': {
        method: 'GET',
        path: () => '/client/businesses/' + BIZ + '/wallet',
        run: (p, me) => walletView(me),
      },
      'client.giftCard': {
        method: 'GET',
        path: (p) => '/client/businesses/' + BIZ + '/wallet/gift-cards/' + p.id,
        run: (p, me) => {
          const c = S.db.GiftCards.find((x) => x.id === p.id && x.recipient_user_id === me);
          if (!c) fail(404, 'Gift card not found.');
          return cardView(c);
        },
      },
      'client.buyGiftCard': {
        method: 'POST',
        path: () => '/client/businesses/' + BIZ + '/gift-cards',
        run: (p, me) => {
          const buyer = user(me);
          const r = p.recipient || {};
          if (!r.name || !String(r.name).trim()) fail(422, "Enter the recipient's name.");
          const phone = toE164(r.phone);
          if (!phone) fail(422, "Enter the recipient's WhatsApp number, with the country code.");
          if (!r.email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(r.email)) fail(422, "Enter the recipient's email address.");
          const amount = Number(p.amount);
          if (!(amount >= 50)) fail(422, 'Choose an amount of EGP 50 or more.');
          if (phone === buyer.phone) fail(422, "You can't buy a gift card for yourself.");
          const order = ins('GiftCardOrders', {
            id: nextId('gco'),
            business_id: BIZ,
            sender_user_id: me,
            channel: 'online',
            card_amount: r2(amount),
            quantity: 1,
            total_amount: r2(amount),
            payment_transaction_id: null,
            status: 'pending_payment',
            recipients: [{ name: String(r.name).trim(), phone, email: r.email }],
            created_by: null,
            created_at: S.now,
          });
          const t = txn({ user_id: me, booking_type: 'gift_card', booking_id: order.id, method: 'pay_online', amount, status: 'pending' });
          upd('GiftCardOrders', order, { payment_transaction_id: t.id });
          return {
            order_id: order.id,
            status: 'pending_payment',
            payment: { transaction_id: t.id, amount: t.amount, currency: CUR, redirect_url: 'https://accept.paymob.com/unifiedcheckout/?session=' + t.id },
          };
        },
      },
      'client.checkout': {
        method: 'POST',
        path: () => '/bookings/cart/checkout',
        run: (p, me) => {
          const s = service(p.service_id);
          if (!s) fail(404, 'Service not found.');
          const b = ins('Bookings', {
            id: nextId('bk'),
            kind: s.kind,
            user_id: me,
            service_id: s.id,
            title: s.title,
            price: s.price,
            status: 'pending',
            payment_state: 'unpaid',
            client_package_id: null,
            starts_at: S.now + 3 * DAY,
            created_at: S.now,
          });
          if (p.client_package_id) {
            const pk = S.db.ClientPackages.find((x) => x.id === p.client_package_id && x.user_id === me);
            if (!pk || pk.sessions_remaining < 1) fail(409, 'This package has no sessions left.');
            if (p.use_wallet) fail(422, 'A booking covered by a package cannot also use the wallet.');
            upd('ClientPackages', pk, { sessions_remaining: pk.sessions_remaining - 1 });
            upd('Bookings', b, { status: 'confirmed', payment_state: 'covered', client_package_id: pk.id });
            say('Booking confirmation to ' + user(me).full_name + ' for ' + b.title + '.');
            return { booked: true, booking_id: b.id, items: [{ classification: 'covered', payable: 0 }], total_payable: 0, wallet: { applied: 0, balance_after: balance(me) } };
          }
          const applied = p.use_wallet ? Math.min(balance(me), s.price) : 0;
          const payable = r2(s.price - applied);
          if (applied > 0) debit({ user_id: me, amount: applied, reason: 'spend', status: 'held', reference_type: s.kind, reference_id: b.id });
          if (payable === 0) {
            finalizeBooking(b, true);
            return { booked: true, booking_id: b.id, items: [{ classification: 'wallet_full', payable: 0 }], total_payable: 0, wallet: { applied, balance_after: balance(me) } };
          }
          const t = txn({ user_id: me, booking_type: s.kind, booking_id: b.id, method: 'pay_online', amount: payable, status: 'pending' });
          return {
            booked: false,
            booking_id: b.id,
            items: [{ classification: applied > 0 ? 'wallet_partial' : 'online_full', payable }],
            total_payable: payable,
            wallet: { applied, held: applied > 0, balance_after: balance(me) },
            payment: { transaction_id: t.id, amount: payable, currency: CUR, redirect_url: 'https://accept.paymob.com/unifiedcheckout/?session=' + t.id },
          };
        },
      },
      'gateway.webhook': {
        method: 'POST',
        path: () => '/payments/webhook/paymob',
        run: (p) => {
          const t = S.db.PaymentTransactions.find((x) => x.id === p.transaction_id);
          if (!t) fail(404, 'Unknown transaction.');
          if (t.payment_status !== 'pending') return { received: true, replayed: true };
          upd('PaymentTransactions', t, { payment_status: p.success ? 'completed' : 'failed' });
          if (t.booking_type === 'gift_card') {
            const order = S.db.GiftCardOrders.find((o) => o.id === t.booking_id);
            if (!p.success) {
              upd('GiftCardOrders', order, { status: 'failed' });
              return { received: true, order_status: 'failed' };
            }
            upd('GiftCardOrders', order, { status: 'paid' });
            const cards = order.recipients.map((r) => issueCard(order, r, order.sender_user_id));
            return { received: true, order_status: 'paid', gift_cards: cards.map((c) => ({ id: c.id, code: c.code, status: c.status })) };
          }
          const b = S.db.Bookings.find((x) => x.id === t.booking_id);
          finalizeBooking(b, p.success);
          return { received: true, booking_status: b.status, wallet_hold: p.success ? 'posted' : 'released' };
        },
      },
      'client.cancelBooking': {
        method: 'PATCH',
        path: (p) => (p.kind === 'appointment' ? '/client/appointments/' : '/client/classes/') + p.id + '/cancel',
        run: (p, me) => {
          const b = S.db.Bookings.find((x) => x.id === p.id && x.user_id === me);
          if (!b || b.status !== 'confirmed') fail(404, 'Booking not found or already cancelled.');
          const res = refundBooking(b, { reason: 'Cancelled by client' });
          return { cancelled: true, refund: res, wallet_balance: balance(me) };
        },
      },
      'auth.verifyPhone': {
        method: 'POST',
        path: () => '/auth/phone/verify',
        run: (p) => {
          const phone = toE164(p.phone);
          if (!phone) fail(422, 'Enter a valid WhatsApp number.');
          if (!p.name || !String(p.name).trim()) fail(422, 'Enter your name.');
          let u = clientByPhone(phone);
          if (u) upd('Users', u, { phone_verified_at: S.now });
          else u = ins('Users', { id: nextId('usr'), full_name: String(p.name).trim(), phone, email: p.email || null, role: 'user', phone_verified_at: S.now, created_at: S.now });
          const claimed = [];
          for (const c of S.db.GiftCards.filter((x) => x.recipient_phone === phone && x.status === 'pending_claim')) {
            upd('GiftCards', c, { recipient_user_id: u.id, status: 'active', claimed_at: S.now });
            creditFromCard(c, u);
            claimed.push({ id: c.id, code: c.code, amount: c.amount });
          }
          if (claimed.length) say('In-app notice to ' + u.full_name + ': ' + claimed.length + ' gift card' + (claimed.length > 1 ? 's were' : ' was') + ' added to your wallet.');
          return { user_id: u.id, phone_verified: true, claimed_gift_cards: claimed, wallet_balance: balance(u.id) };
        },
      },

      /* ===== business app ===== */
      'biz.giftCards': {
        method: 'GET',
        path: () => '/business/' + BIZ + '/gift-cards',
        run: () => ({ gift_cards: S.db.GiftCards.map(cardView).sort((a, b) => b.created_at - a.created_at) }),
      },
      'biz.giftCard': {
        method: 'GET',
        path: (p) => '/business/' + BIZ + '/gift-cards/' + p.id,
        run: (p) => {
          const c = S.db.GiftCards.find((x) => x.id === p.id);
          if (!c) fail(404, 'Gift card not found.');
          return cardView(c);
        },
      },
      'biz.assignGiftCard': {
        method: 'POST',
        path: () => '/business/' + BIZ + '/gift-cards',
        run: (p, me) => {
          const amount = Number(p.amount);
          if (!(amount >= 50)) fail(422, 'Enter an amount of EGP 50 or more.');
          if (!METHOD_LABEL[p.payment_method_slug] || p.payment_method_slug === 'wallet') fail(422, 'Choose how the sale was paid.');
          const rec = resolveClient(p.recipient, 'Recipient');
          const snd = resolveClient(p.sender, 'Sender');
          if (rec.id === snd.id) fail(422, 'Recipient and sender must be different clients.');
          const order = ins('GiftCardOrders', {
            id: nextId('gco'), business_id: BIZ, sender_user_id: snd.id, channel: 'admin', card_amount: r2(amount), quantity: 1,
            total_amount: r2(amount), payment_transaction_id: null, status: 'paid',
            recipients: [{ name: rec.full_name, phone: rec.phone, email: rec.email }], created_by: me, created_at: S.now,
          });
          const t = txn({ user_id: snd.id, booking_type: 'gift_card', booking_id: order.id, method: p.payment_method_slug, amount, status: 'completed' });
          upd('GiftCardOrders', order, { payment_transaction_id: t.id });
          const c = issueCard(order, order.recipients[0], snd.id);
          return { order_id: order.id, payment_transaction_id: t.id, gift_card: cardView(c) };
        },
      },
      'biz.assignGiftCardsBulk': {
        method: 'POST',
        path: () => '/business/' + BIZ + '/gift-cards/bulk',
        run: (p, me) => {
          const amount = Number(p.amount);
          if (!(amount >= 50)) fail(422, 'Enter an amount of EGP 50 or more. Every recipient gets the same amount.');
          if (!METHOD_LABEL[p.payment_method_slug] || p.payment_method_slug === 'wallet') fail(422, 'Choose how the sale was paid.');
          if (!Array.isArray(p.recipients) || p.recipients.length < 2) fail(422, 'Add at least two recipients.');
          const snd = resolveClient(p.sender, 'Sender');
          const recs = p.recipients.map((r, i) => resolveClient(r, 'Recipient ' + (i + 1)));
          if (new Set(recs.map((r) => r.id)).size !== recs.length) fail(422, 'The same client is listed twice.');
          if (recs.some((r) => r.id === snd.id)) fail(422, 'The sender cannot also be a recipient.');
          const total = r2(amount * recs.length);
          const order = ins('GiftCardOrders', {
            id: nextId('gco'), business_id: BIZ, sender_user_id: snd.id, channel: 'admin', card_amount: r2(amount), quantity: recs.length,
            total_amount: total, payment_transaction_id: null, status: 'paid',
            recipients: recs.map((r) => ({ name: r.full_name, phone: r.phone, email: r.email })), created_by: me, created_at: S.now,
          });
          const t = txn({ user_id: snd.id, booking_type: 'gift_card', booking_id: order.id, method: p.payment_method_slug, amount: total, status: 'completed' });
          upd('GiftCardOrders', order, { payment_transaction_id: t.id });
          const cards = order.recipients.map((r) => issueCard(order, r, snd.id));
          return { order_id: order.id, payment_transaction_id: t.id, total_amount: total, gift_cards: cards.map((c) => ({ id: c.id, code: c.code, recipient: c.recipient_name, amount: c.amount })) };
        },
      },
      'biz.voidGiftCard': {
        method: 'POST',
        path: (p) => '/business/' + BIZ + '/gift-cards/' + p.id + '/void',
        run: (p, me) => {
          const c = S.db.GiftCards.find((x) => x.id === p.id);
          if (!c) fail(404, 'Gift card not found.');
          if (c.status === 'voided') fail(409, 'This gift card is already voided.');
          if (p.refund_destination !== 'wallet' && p.refund_destination !== 'original_method') fail(422, 'Choose where the refund goes: wallet or original method of payment.');
          const v = cardView(c);
          if (v.remaining <= 0) fail(409, 'Nothing is left on this gift card to void.');
          const sender = user(c.sender_user_id);
          if (c.status === 'active') {
            const mine = lots(c.recipient_user_id).filter((l) => l.gift_card_id === c.id);
            debit({ user_id: c.recipient_user_id, amount: v.remaining, reason: 'void', lots: mine, lotEndStatus: 'reversed', reference_type: 'gift_card', reference_id: c.id, created_by: me });
          }
          const t = S.db.PaymentTransactions.find((x) => x.id === c.payment_transaction_id);
          const rf = refund({ txn: t, amount: v.remaining, destination: p.refund_destination, reason: p.reason || 'Gift card voided', by: me });
          if (p.refund_destination === 'wallet') {
            const cr = credit({ user_id: sender.id, reason: 'refund', amount: v.remaining, source_transaction_id: t.id, source_refund_id: rf.id, reference_type: 'gift_card', reference_id: c.id, created_by: me });
            upd('PaymentRefunds', rf, { wallet_ledger_id: cr.id });
            say('WhatsApp to ' + sender.full_name + ': "Your gift card ' + c.code + ' was cancelled. ' + CUR + ' ' + v.remaining + ' is in your wallet."');
          } else {
            say(t.payment_gateway ? 'Paymob refund of ' + CUR + ' ' + v.remaining + ' to the card that paid for ' + c.code + '.' : 'Staff hand back ' + CUR + ' ' + v.remaining + ' (' + METHOD_LABEL[t.payment_method] + '). Recorded, no gateway call.');
          }
          const refundedSoFar = r2(S.db.PaymentRefunds.filter((x) => x.payment_transaction_id === t.id).reduce((s, x) => s + x.refund_amount, 0));
          upd('PaymentTransactions', t, { payment_status: refundedSoFar >= t.amount ? 'refunded' : 'partially_refunded' });
          upd('GiftCards', c, { status: 'voided', voided_at: S.now, voided_by: me, void_refund_destination: p.refund_destination, void_refund_amount: v.remaining });
          return { gift_card: cardView(c), refund: { id: rf.id, amount: v.remaining, destination: p.refund_destination, to: sender.full_name } };
        },
      },
      'biz.clientWallet': {
        method: 'GET',
        path: (p) => '/business/' + BIZ + '/clients/' + p.client_id + '/wallet',
        run: (p) => {
          if (!user(p.client_id)) fail(404, 'Client not found.');
          return walletView(p.client_id);
        },
      },
      'biz.completeCheckout': {
        method: 'POST',
        path: (p) => '/business/' + BIZ + '/dashboard/checkout/' + p.id + '/complete',
        run: (p, me) => {
          const b = S.db.Bookings.find((x) => x.id === p.id);
          if (!b || b.payment_state !== 'unpaid') fail(404, 'Nothing to check out for this booking.');
          const w = r2(Number(p.wallet_amount) || 0);
          if (w < 0 || w > b.price) fail(422, 'Wallet amount must be between 0 and the price.');
          if (w > balance(b.user_id)) fail(409, 'The client only has ' + CUR + ' ' + balance(b.user_id) + ' in their wallet.');
          const rest = r2(b.price - w);
          if (rest > 0 && (!METHOD_LABEL[p.payment_method_slug] || p.payment_method_slug === 'wallet')) fail(422, 'Choose a payment method for the remaining ' + CUR + ' ' + rest + '.');
          const paid = [];
          if (w > 0) {
            debit({ user_id: b.user_id, amount: w, reason: 'spend', reference_type: b.kind, reference_id: b.id, created_by: me });
            const t = txn({ user_id: b.user_id, booking_type: b.kind, booking_id: b.id, method: 'wallet', amount: w, status: 'completed' });
            paid.push({ method: 'wallet', amount: w, transaction_id: t.id });
          }
          if (rest > 0) {
            const t = txn({ user_id: b.user_id, booking_type: b.kind, booking_id: b.id, method: p.payment_method_slug, amount: rest, status: 'completed' });
            paid.push({ method: p.payment_method_slug, amount: rest, transaction_id: t.id });
          }
          upd('Bookings', b, { status: 'completed', payment_state: 'paid' });
          return { checked_out: true, booking_id: b.id, paid, wallet_balance_after: balance(b.user_id) };
        },
      },
      'biz.refundCancel': {
        method: 'POST',
        path: (p) => '/business/' + BIZ + '/dashboard/checkout/class-booking/' + p.id + '/refund-cancel',
        run: (p, me) => {
          const b = S.db.Bookings.find((x) => x.id === p.id);
          if (!b || (b.status !== 'confirmed' && b.status !== 'completed')) fail(404, 'Booking not found or not refundable.');
          if (p.refund_destination !== 'wallet' && p.refund_destination !== 'original_method') fail(422, 'Choose where the refund goes: wallet or original method of payment.');
          const res = refundBooking(b, { destination: p.refund_destination, by: me, reason: 'Cancelled by the business' });
          return { cancelled: true, refund: res, client_wallet_balance: balance(b.user_id) };
        },
      },
      'biz.getWalletSettings': {
        method: 'GET',
        path: () => '/business/' + BIZ + '/wallet/settings',
        run: () => ({ refund_to_wallet_enabled: cfg().refund_to_wallet_enabled, credit_expiry_months: cfg().credit_expiry_months }),
      },
      'biz.putWalletSettings': {
        method: 'PUT',
        path: () => '/business/' + BIZ + '/wallet/settings',
        run: (p, me) => {
          const patch = {};
          if (typeof p.refund_to_wallet_enabled === 'boolean') patch.refund_to_wallet_enabled = p.refund_to_wallet_enabled;
          if (p.credit_expiry_months !== undefined) {
            const m = Number(p.credit_expiry_months);
            if (!Number.isInteger(m) || m < 1 || m > 36) fail(422, 'Expiry must be a whole number of months between 1 and 36.');
            patch.credit_expiry_months = m;
          }
          patch.updated_by = me;
          patch.updated_at = S.now;
          upd('BusinessWalletConfigs', cfg(), patch);
          return { refund_to_wallet_enabled: cfg().refund_to_wallet_enabled, credit_expiry_months: cfg().credit_expiry_months, applies_to: 'credits added from now on' };
        },
      },

      /* ===== scheduler ===== */
      'cron.walletExpiry': {
        method: 'POST',
        path: () => '/internal/cron/wallet-expiry',
        run: () => {
          const due = S.db.WalletLedgers.filter((e) => e.entry_type === 'credit' && e.status === 'active' && e.remaining_amount > 0 && e.expires_at && e.expires_at <= S.now);
          let total = 0;
          const people = new Set();
          for (const lot of due) {
            const amt = lot.remaining_amount;
            debit({ user_id: lot.user_id, amount: amt, reason: 'expiry', lots: [lot], lotEndStatus: 'expired', reference_type: 'wallet_lot', reference_id: lot.id });
            total = r2(total + amt);
            people.add(lot.user_id);
          }
          if (due.length) say('Expiry notices sent to ' + people.size + ' client' + (people.size > 1 ? 's' : '') + '.');
          return { expired_credits: due.length, expired_amount: total, clients_affected: people.size };
        },
      },
    };

    /* Run one handler as a transaction and write it to the API log. */
    function call(key, params, actor, meId) {
      const h = H[key];
      const snapshot = JSON.stringify({ db: S.db, counters: S.counters, codeSeed });
      S.tick += 1;
      touched = new Set();
      effects = [];
      const rec = { n: S.tick, at: S.now, actor, method: h.method, path: h.path(params || {}), request: h.method === 'GET' ? null : params || {}, status: 200, response: null, effects: [], tables: [], ok: true };
      try {
        rec.response = h.run(params || {}, meId);
        if (h.method === 'POST' && /gift-cards(\/bulk)?$/.test(rec.path)) rec.status = 201;
        rec.effects = effects;
        rec.tables = Array.from(touched);
      } catch (e) {
        if (!e || !e.status) throw e;
        const back = JSON.parse(snapshot);
        S.db = back.db;
        S.counters = back.counters;
        codeSeed = back.codeSeed;
        rec.ok = false;
        rec.status = e.status;
        rec.response = { error: e.message };
      }
      touched = null;
      effects = null;
      S.log.push(rec);
      return rec;
    }

    /* Move the clock. The nightly expiry job runs if anything is due. */
    function advance(days) {
      S.now += days * DAY;
      const due = S.db.WalletLedgers.some((e) => e.entry_type === 'credit' && e.status === 'active' && e.remaining_amount > 0 && e.expires_at && e.expires_at <= S.now);
      return due ? call('cron.walletExpiry', {}, 'system', null) : null;
    }

    /* ---------- sample data, created through the same handlers ---------- */
    function seed() {
      const start = S.now;
      S.db.BusinessWalletConfigs.push({ business_id: BIZ, refund_to_wallet_enabled: false, credit_expiry_months: 6, updated_by: null, updated_at: start - 60 * DAY, _t: 0 });
      const people = [
        ['usr_omar', 'Omar Farouk', '+201000000101', 'omar@example.com', true],
        ['usr_salma', 'Salma Hassan', '+201000000102', 'salma@example.com', true],
        ['usr_delta', 'Delta Tech (company)', '+201000000110', 'office@deltatech.example', false],
        ['usr_nour', 'Nour Adel', '+201000000111', 'nour@example.com', true],
        ['usr_karim', 'Karim Mostafa', '+201000000112', null, false],
        ['usr_admin', 'Mona (front desk)', '+201000000100', 'mona@nileflow.example', true],
      ];
      for (const [id, full_name, phone, email, verified] of people) {
        S.db.Users.push({ id, full_name, phone, email, role: id === 'usr_admin' ? 'business_admin' : 'user', phone_verified_at: verified ? start - 200 * DAY : null, created_at: start - 200 * DAY, _t: 0 });
      }
      S.db.ClientPackages.push({ id: 'cpk_001', user_id: 'usr_omar', title: '5-class pass', sessions_total: 5, sessions_remaining: 2, covers: 'class_booking', _t: 0 });

      // 41 days ago: Salma buys Omar a EGP 1,000 gift card online.
      S.now = start - 41 * DAY;
      const buy = call('client.buyGiftCard', { recipient: { name: 'Omar Farouk', phone: '+20 100 000 0101', email: 'omar@example.com' }, amount: 1000 }, 'b2c', 'usr_salma');
      call('gateway.webhook', { transaction_id: buy.response.payment.transaction_id, success: true }, 'system', null);

      // 12 days ago: Omar pays for a class from his wallet.
      S.now = start - 12 * DAY;
      call('client.checkout', { service_id: 'svc_vinyasa', use_wallet: true }, 'b2c', 'usr_omar');
      const past = S.db.Bookings[S.db.Bookings.length - 1];
      past.starts_at = start - 10 * DAY;
      past.status = 'completed';

      // 9 days ago: the front desk sells Delta Tech two gift cards in one sale.
      S.now = start - 9 * DAY;
      call('biz.assignGiftCardsBulk', { sender: { client_id: 'usr_delta' }, recipients: [{ client_id: 'usr_nour' }, { client_id: 'usr_karim' }], amount: 750, payment_method_slug: 'card_at_venue' }, 'b2b', 'usr_admin');

      // 2 days ago: Omar books a class and pays the full price by card.
      S.now = start - 2 * DAY;
      const co = call('client.checkout', { service_id: 'svc_reformer', use_wallet: false }, 'b2c', 'usr_omar');
      call('gateway.webhook', { transaction_id: co.response.payment.transaction_id, success: true }, 'system', null);

      // Today: Omar has a massage to pay for at the front desk.
      S.now = start;
      S.db.Bookings.push({ id: nextId('bk'), kind: 'appointment', user_id: 'usr_omar', service_id: 'svc_massage', title: 'Deep Tissue Massage', price: 900, status: 'confirmed', payment_state: 'unpaid', client_package_id: null, starts_at: start + 2 * 3600000, created_at: start - 3 * DAY, _t: 0 });
      S.seedTicks = S.tick;
    }
    seed();

    return {
      S,
      BIZ,
      CUR,
      METHOD_LABEL,
      call,
      advance,
      toE164,
      user,
      service,
      balance,
      walletView,
      cardView,
      cards: () => S.db.GiftCards.map(cardView).sort((a, b) => b.created_at - a.created_at),
      clients: () => S.db.Users.filter((u) => u.role === 'user'),
    };
  }

  root.WalletSim = { create };
})(typeof window !== 'undefined' ? window : globalThis);
