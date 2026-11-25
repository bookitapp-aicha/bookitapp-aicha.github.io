/* Renders the two app mock-ups, the API log and the database view on top of sim.js. */
(function () {
  'use strict';
  if (!window.WalletSim) return;

  let sim = window.WalletSim.create();
  let ui = fresh();

  /* ---------- helpers ---------- */
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const c2 = (n) => 'EGP ' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); // client app format
  const b2 = (n) => Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 }) + ' EGP'; // business app format
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const dt = (ts) => {
    const d = new Date(ts + 2 * 3600000); // Cairo wall clock
    return d.getUTCDate() + ' ' + MON[d.getUTCMonth()] + ' ' + d.getUTCFullYear();
  };
  const svg = (d, s) => '<svg viewBox="0 0 24 24" width="' + (s || 20) + '" height="' + (s || 20) + '" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + '</svg>';
  const I = {
    menu: svg('<path d="M4 7h16M4 12h16M4 17h16"/>'),
    back: svg('<path d="M15 5l-7 7 7 7"/>'),
    chev: svg('<path d="M9 5l7 7-7 7"/>', 16),
    wallet: svg('<path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H18v4"/><path d="M3 7.5V17a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2H5.5A2.5 2.5 0 0 1 3 7.5z"/><path d="M16.5 14h.01"/>', 18),
    gift: svg('<path d="M4 11h16v9H4zM3 7h18v4H3zM12 7v13"/><path d="M12 7c-1.5-3.5-5.5-3-5 0M12 7c1.5-3.5 5.5-3 5 0"/>', 18),
    check: svg('<path d="M5 12.5l4.5 4.5L19 7.5"/>', 28),
    grid: svg('<path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z"/>', 18),
    cal: svg('<path d="M4 6h16v14H4zM4 10h16M8 3v4M16 3v4"/>', 18),
    chart: svg('<path d="M5 20V10M12 20V4M19 20v-7"/>', 18),
  };
  const BADGE = {
    active: ['ok', 'Active'],
    pending_claim: ['wait', 'Waiting for sign-up'],
    used: ['mute', 'Used up'],
    expired: ['mute', 'Expired'],
    voided: ['bad', 'Voided'],
  };
  const badge = (s) => '<span class="p-badge ' + BADGE[s][0] + '">' + BADGE[s][1] + '</span>';
  const WHO = { b2c: 'Client app', b2b: 'Business app', system: 'System' };

  function fresh() {
    return {
      view: 'c',
      insp: 'api',
      openLog: null,
      table: 'WalletLedgers',
      c: { me: 'usr_omar', screen: 'home', params: {}, menu: false, sheet: null, toast: null, tab: 'class_booking', gift: { name: '', phone: '', email: '', amount: '500' }, co: { pay: 'online', useWallet: true }, su: { name: '', phone: '' } },
      b: { me: 'usr_admin', screen: 'giftcards', params: {}, sheet: null, toast: null, as: blankAssign('single'), cfg: { on: false, months: 6 } },
    };
  }
  function blankParty() {
    return { sel: '', name: '', phone: '', email: '' };
  }
  function blankAssign(mode) {
    return { mode, recs: mode === 'bulk' ? [blankParty(), blankParty()] : [blankParty()], sender: blankParty(), amount: '', method: 'cash_instapay_at_venue' };
  }
  function setPath(path, val) {
    const ks = path.split('.');
    let o = ui;
    for (let i = 0; i < ks.length - 1; i++) o = o[ks[i]];
    o[ks[ks.length - 1]] = val;
  }
  const S = () => sim.S;
  const txnsOf = (b) => S().db.PaymentTransactions.filter((t) => t.booking_type === b.kind && t.booking_id === b.id);
  const lastWrite = () => {
    for (let i = S().log.length - 1; i >= 0; i--) if (S().log[i].tables.length) return S().log[i];
    return null;
  };
  function api(key, params, actor, me) {
    const rec = sim.call(key, params, actor, me);
    ui.openLog = rec.n;
    return rec;
  }
  const toastC = (msg, bad) => (ui.c.toast = { msg, bad: !!bad });
  const toastB = (msg, bad) => (ui.b.toast = { msg, bad: !!bad });

  /* =====================================================================
   * CLIENT APP
   * ===================================================================== */
  function ownedPackage(me, svc) {
    if (!svc || svc.kind !== 'class_booking') return null;
    return S().db.ClientPackages.find((p) => p.user_id === me && p.sessions_remaining > 0) || null;
  }
  function paidSummary(b, fmt) {
    if (b.payment_state === 'covered') return 'Package session';
    const parts = txnsOf(b).filter((t) => t.payment_status === 'completed' || t.payment_status === 'refunded').map((t) => sim.METHOD_LABEL[t.payment_method] + ' ' + fmt(t.amount));
    return parts.length ? parts.join(' + ') : 'Not paid yet';
  }

  function cHome(me) {
    const bal = me ? sim.balance(me) : 0;
    const tabs = [['appointment', 'Appointments'], ['class_booking', 'Classes'], ['package', 'Packages']];
    const list = S().services.filter((s) => s.kind === ui.c.tab);
    return (
      '<div class="p-cover"><h3>Nile Flow Studio</h3><p><span class="p-open">Open</span> · Zamalek · <u>Get directions</u></p></div>' +
      (bal > 0 ? '<button class="p-walletchip" data-a="c.go" data-s="wallet">' + I.wallet + '<span>Wallet</span><b>' + c2(bal) + '</b><em>ready to use</em></button>' : '') +
      '<button class="p-giftbanner" data-a="c.go" data-s="gift">' + I.gift + '<span><b>Give a gift card</b><small>Send credit to a friend\'s WhatsApp number</small></span>' + I.chev + '</button>' +
      '<div class="p-tabs">' + tabs.map((t) => '<button class="' + (ui.c.tab === t[0] ? 'on' : '') + '" data-a="c.tab" data-k="' + t[0] + '">' + t[1] + '</button>').join('') + '</div>' +
      list.map((s) => '<div class="p-card p-svc"><div><b>' + esc(s.title) + '</b><small>' + esc(s.meta) + '</small><span>' + c2(s.price) + '</span></div><button class="p-btn small" data-a="c.book" data-id="' + s.id + '">' + (s.kind === 'package' ? 'Buy' : 'Book') + '</button></div>').join('')
    );
  }

  function cGift() {
    const g = ui.c.gift;
    const presets = ['250', '500', '1000', '2000'];
    const amt = Number(g.amount) || 0;
    return (
      '<p class="p-lead">They get the credit in their wallet at Nile Flow Studio. You are shown as the sender.</p>' +
      '<label class="p-label" for="cg-name">Recipient\'s name</label><input class="p-input" id="cg-name" data-f="c.gift.name" value="' + esc(g.name) + '" autocomplete="off">' +
      '<label class="p-label" for="cg-phone">Recipient\'s WhatsApp number</label><input class="p-input" id="cg-phone" data-f="c.gift.phone" value="' + esc(g.phone) + '" placeholder="+20 100 000 0000" inputmode="tel" autocomplete="off">' +
      '<small class="p-hint">The gift card is tied to this number.</small>' +
      '<label class="p-label" for="cg-email">Recipient\'s email</label><input class="p-input" id="cg-email" data-f="c.gift.email" value="' + esc(g.email) + '" inputmode="email" autocomplete="off">' +
      '<span class="p-label">Amount</span><div class="p-chips">' + presets.map((p) => '<button class="p-chip ' + (g.amount === p ? 'on' : '') + '" data-a="c.gift-amt" data-v="' + p + '">' + Number(p).toLocaleString('en-US') + '</button>').join('') + '</div>' +
      '<label class="p-label" for="cg-amt">Or type an amount (EGP)</label><input class="p-input" id="cg-amt" data-f="c.gift.amount" value="' + esc(g.amount) + '" inputmode="numeric" autocomplete="off">' +
      '<div class="p-note">Paid online by card. A gift card cannot be paid for from your wallet.</div>' +
      '<button class="p-btn wide" data-a="c.gift-buy"><span>Checkout</span><span>' + c2(amt) + '</span></button>'
    );
  }

  function gcCardC(v) {
    const pct = Math.max(0, Math.min(100, (v.remaining / v.amount) * 100));
    return (
      '<button class="p-gc" data-a="c.go" data-s="card" data-id="' + v.id + '"><span class="p-gc-top"><b>From ' + esc(v.sender.name) + '</b>' + badge(v.status) + '</span>' +
      '<span class="p-gc-id">' + v.code + '</span><span class="p-bar"><i style="width:' + pct + '%"></i></span>' +
      '<span class="p-gc-nums"><span>Original<b>' + c2(v.amount) + '</b></span><span>Used<b>' + c2(v.used) + '</b></span><span>Remaining<b>' + c2(v.remaining) + '</b></span></span></button>'
    );
  }
  function cWallet(me) {
    const w = sim.walletView(me);
    const empty = !w.gift_cards.length && !w.activity.length;
    return (
      '<div class="p-bal"><span>Wallet balance · Nile Flow Studio</span><b>' + c2(w.balance) + '</b><small>' +
      (w.next_expiry ? c2(w.next_expiry.amount) + ' expires on ' + dt(w.next_expiry.expires_at) : 'Nothing to spend right now') + '</small></div>' +
      (empty ? '<p class="p-lead">Gift cards and refunds from Nile Flow Studio show up here.</p>' : '') +
      (w.gift_cards.length ? '<h5 class="p-h">Gift cards</h5>' + w.gift_cards.map(gcCardC).join('') : '') +
      (w.activity.length ? '<h5 class="p-h">Wallet activity</h5><div class="p-list">' + w.activity.map((a) => '<div class="p-act"><span><b>' + esc(a.label) + '</b><small>' + dt(a.at) + (a.expires_at ? ' · expires ' + dt(a.expires_at) : '') + '</small></span><span class="' + (a.amount > 0 ? 'plus' : 'minus') + '">' + (a.amount > 0 ? '+' : '−') + c2(Math.abs(a.amount)) + '</span></div>').join('') + '</div>' : '')
    );
  }
  function usageList(v, fmt) {
    if (!v.usage.length) return '<p class="p-lead">Not used yet.</p>';
    return '<div class="p-list">' + v.usage.map((u) => '<div class="p-act"><span><b>' + esc(u.label) + '</b><small>' + dt(u.at) + ' · ' + u.kind + '</small></span><span class="' + (u.amount > 0 ? 'plus' : 'minus') + '">' + (u.amount > 0 ? '+' : '−') + fmt(Math.abs(u.amount)) + '</span></div>').join('') + '</div>';
  }
  function cCard(me) {
    const card = S().db.GiftCards.find((x) => x.id === ui.c.params.id);
    const v = sim.cardView(card);
    return (
      '<div class="p-card p-gcd"><span class="p-gc-top"><b>From ' + esc(v.sender.name) + '</b>' + badge(v.status) + '</span><span class="p-gc-id">' + v.code + '</span>' +
      '<div class="p-gc-nums"><span>Original<b>' + c2(v.amount) + '</b></span><span>Used<b>' + c2(v.used) + '</b></span><span>Remaining<b>' + c2(v.remaining) + '</b></span></div>' +
      '<small>Added to your wallet on ' + dt(v.claimed_at) + (v.expires_at ? ' · use by ' + dt(v.expires_at) : '') + '</small></div>' +
      '<h5 class="p-h">Usage</h5>' + usageList(v, c2)
    );
  }

  function cCheckout(me) {
    const s = sim.service(ui.c.params.id);
    const co = ui.c.co;
    const pk = ownedPackage(me, s);
    const bal = sim.balance(me);
    const viaPackage = pk && co.pay === 'package';
    const applied = !viaPackage && co.useWallet ? Math.min(bal, s.price) : 0;
    const payable = viaPackage ? 0 : s.price - applied;
    let h = '<div class="p-card"><b>' + esc(s.title) + '</b><small>' + esc(s.meta) + (s.kind !== 'package' ? ' · ' + dt(S().now + 3 * 86400000) + ', 10:00' : '') + '</small></div><h5 class="p-h">How would you like to pay?</h5>';
    if (pk) h += '<button class="p-tile ' + (viaPackage ? 'on' : '') + '" data-a="c.pay" data-v="package"><span><b>' + esc(pk.title) + '</b><small>' + pk.sessions_remaining + ' of ' + pk.sessions_total + ' sessions left · EGP 0.00 (included)</small></span></button>';
    h += '<button class="p-tile ' + (!viaPackage ? 'on' : '') + '" data-a="c.pay" data-v="online"><span><b>Online Payment</b><small>Card, through Paymob</small></span></button>';
    if (bal > 0) {
      h += viaPackage
        ? '<div class="p-note">This booking is covered by your package, so your wallet is not used.</div>'
        : '<button class="p-switchrow" data-a="c.wallet-toggle" role="switch" aria-checked="' + !!co.useWallet + '"><span><b>Use wallet balance</b><small>' + c2(bal) + ' available · spent before your card</small></span><i class="p-switch ' + (co.useWallet ? 'on' : '') + '"></i></button>';
    }
    h += '<h5 class="p-h">Order summary</h5><div class="p-sum"><div><span>Total price</span><span>' + c2(viaPackage ? 0 : s.price) + '</span></div>' +
      (applied > 0 ? '<div class="plus"><span>Wallet</span><span>−' + c2(applied) + '</span></div>' : '') +
      '<div class="tot"><span>Payable right now</span><span>' + c2(payable) + '</span></div></div>' +
      '<button class="p-btn wide" data-a="c.checkout">' + (payable > 0 ? '<span>Checkout</span><span>' + c2(payable) + '</span>' : '<span>bookit</span>') + '</button>';
    return h;
  }

  function cDone() {
    const p = ui.c.params;
    if (p.kind === 'gift') {
      const v = sim.cardView(S().db.GiftCards.find((x) => x.id === p.id));
      return (
        '<div class="p-done"><span class="p-tick">' + I.check + '</span><h3>Gift card sent</h3><p>' + c2(v.amount) + ' for ' + esc(v.recipient.name) + '</p><span class="p-gc-id">' + v.code + '</span></div>' +
        '<div class="p-note">' + (v.status === 'pending_claim' ? esc(v.recipient.name) + ' has no account yet. The card waits for them to sign up with ' + esc(v.recipient.phone) + '.' : 'It is already in ' + esc(v.recipient.name) + "'s wallet. They were told by WhatsApp and email.") + '</div>' +
        '<button class="p-btn wide" data-a="c.go" data-s="home"><span>Back to studio</span></button>'
      );
    }
    const b = S().db.Bookings.find((x) => x.id === p.id);
    const rows = b.payment_state === 'covered' ? '<div><span>Package session</span><span>EGP 0.00 (included)</span></div>' : txnsOf(b).filter((t) => t.payment_status === 'completed').map((t) => '<div><span>' + (t.payment_method === 'pay_online' ? 'Card' : sim.METHOD_LABEL[t.payment_method]) + '</span><span>' + c2(t.amount) + '</span></div>').join('');
    return (
      '<div class="p-done"><span class="p-tick">' + I.check + '</span><h3>' + (b.kind === 'package' ? 'Package bought' : "You're booked") + '</h3><p>' + esc(b.title) + '</p></div>' +
      '<div class="p-sum">' + rows + '</div><button class="p-btn wide" data-a="c.go" data-s="bookings"><span>View bookings</span></button><button class="p-btn ghost wide" data-a="c.go" data-s="wallet"><span>View wallet</span></button>'
    );
  }

  function cBookings(me) {
    const mine = S().db.Bookings.filter((b) => b.user_id === me && b.status !== 'failed' && b.status !== 'pending').sort((a, b) => b.starts_at - a.starts_at);
    if (!mine.length) return '<p class="p-lead">No bookings yet.</p>';
    const lab = { confirmed: ['ok', 'Active'], completed: ['mute', 'Completed'], cancelled: ['bad', 'Cancelled'] };
    return mine.map((b) => {
      const canCancel = b.status === 'confirmed' && b.kind !== 'package' && b.payment_state !== 'unpaid' && b.starts_at > S().now;
      return (
        '<div class="p-card p-bk"><span class="p-gc-top"><b>' + esc(b.title) + '</b><span class="p-badge ' + lab[b.status][0] + '">' + lab[b.status][1] + '</span></span><small>' + dt(b.starts_at) + '</small>' +
        '<small>' + (b.payment_state === 'unpaid' ? 'Pay at venue: ' + c2(b.price) : (b.payment_state === 'refunded' ? 'Refunded: ' : 'Paid: ') + paidSummary(b, c2)) + '</small>' +
        (canCancel ? '<button class="p-btn ghost small" data-a="c.cancel-ask" data-id="' + b.id + '">Cancel booking</button>' : '') + '</div>'
      );
    }).join('');
  }
  function cPackages(me) {
    const pk = S().db.ClientPackages.filter((p) => p.user_id === me);
    if (!pk.length) return '<p class="p-lead">No packages yet.</p>';
    return '<h5 class="p-h">Active packages</h5>' + pk.map((p) => '<div class="p-pk"><small>ACTIVE PACKAGE</small><b>' + esc(p.title) + '</b><span>' + p.sessions_remaining + '/' + p.sessions_total + ' sessions · Book Now →</span></div>').join('');
  }
  function cSignup() {
    const su = ui.c.su;
    return (
      '<p class="p-lead">Sign up with your WhatsApp number. Any gift card sent to that number is added to your wallet as soon as the number is verified.</p>' +
      '<label class="p-label" for="cs-name">Full name</label><input class="p-input" id="cs-name" data-f="c.su.name" value="' + esc(su.name) + '" autocomplete="off">' +
      '<label class="p-label" for="cs-phone">WhatsApp number</label><input class="p-input" id="cs-phone" data-f="c.su.phone" value="' + esc(su.phone) + '" placeholder="+20 100 000 0000" inputmode="tel" autocomplete="off">' +
      '<div class="p-note">In the real app a 6-digit WhatsApp code proves the number is yours. The demo skips typing it.</div>' +
      '<button class="p-btn wide" data-a="c.signup"><span>Verify and continue</span></button>'
    );
  }

  function cSheet(me) {
    const sh = ui.c.sheet;
    if (!sh) return '';
    let h = '';
    if (sh.type === 'pay') {
      h = '<small class="p-gw">Paymob card payment · simulated</small><h4>' + c2(sh.amount) + '</h4><p>Card ending 4242</p>' +
        (sh.held > 0 ? '<div class="p-note">' + c2(sh.held) + ' from the wallet is on hold until this payment finishes.</div>' : '') +
        '<button class="p-btn wide" data-a="c.pay-approve"><span>Approve payment</span></button><button class="p-btn ghost wide" data-a="c.pay-decline"><span>Decline payment</span></button>';
    } else if (sh.type === 'cancel') {
      const b = S().db.Bookings.find((x) => x.id === sh.id);
      const toWallet = S().db.BusinessWalletConfigs[0].refund_to_wallet_enabled;
      const lines = b.payment_state === 'covered' ? ['Your package session is returned.'] : txnsOf(b).filter((t) => t.payment_status === 'completed').map((t) => {
        if (t.payment_method === 'wallet') return c2(t.amount) + ' goes back to your wallet.';
        if (t.payment_method === 'pay_online') return toWallet ? c2(t.amount) + ' goes to your wallet at Nile Flow Studio, not to your card.' : c2(t.amount) + ' is refunded to your card.';
        return c2(t.amount) + ' is handed back at the venue.';
      });
      h = '<h4>Cancel ' + esc(b.title) + '?</h4><p>You are inside the free cancellation window.</p>' + lines.map((l) => '<div class="p-note">' + l + '</div>').join('') +
        '<button class="p-btn wide" data-a="c.cancel-do"><span>Cancel booking</span></button><button class="p-btn ghost wide" data-a="c.sheet-close"><span>Keep booking</span></button>';
    } else if (sh.type === 'refunded') {
      h = '<h4>Booking cancelled</h4>' + sh.lines.map((l) => '<div class="p-note ' + (l.wallet ? 'ok' : '') + '">' + l.text + '</div>').join('') +
        '<button class="p-btn wide" data-a="c.go" data-s="wallet"><span>View wallet</span></button><button class="p-btn ghost wide" data-a="c.sheet-close"><span>Done</span></button>';
    }
    return '<div class="p-sheet"><div class="p-sheet-card">' + h + '</div></div>';
  }

  function renderC() {
    const st = ui.c;
    const me = st.me;
    const titles = { home: 'Nile Flow Studio', gift: 'Give a gift card', wallet: 'Wallet', card: 'Gift card', checkout: 'Review and confirm', done: 'Nile Flow Studio', bookings: 'Bookings', packages: 'Packages', signup: 'Create your account' };
    const backTo = { gift: 'home', card: 'wallet', checkout: 'home' };
    let body = '';
    if (!me) body = cSignup();
    else if (st.screen === 'home') body = cHome(me);
    else if (st.screen === 'gift') body = cGift();
    else if (st.screen === 'wallet') body = cWallet(me);
    else if (st.screen === 'card') body = cCard(me);
    else if (st.screen === 'checkout') body = cCheckout(me);
    else if (st.screen === 'done') body = cDone();
    else if (st.screen === 'bookings') body = cBookings(me);
    else if (st.screen === 'packages') body = cPackages(me);
    const scr = me ? st.screen : 'signup';
    const items = [['home', 'Feed'], ['bookings', 'Bookings'], ['packages', 'Packages'], ['wallet', 'Wallet'], ['', 'Profile'], ['', 'Settings']];
    const drawer = st.menu
      ? '<div class="p-drawer"><div class="p-drawer-in"><strong>' + esc(me ? sim.user(me).full_name : 'Not signed in') + '</strong>' +
        (me ? items.map((it) => (it[0] ? '<button class="p-mrow ' + (scr === it[0] ? 'on' : '') + '" data-a="c.go" data-s="' + it[0] + '"><span>' + it[1] + (it[0] === 'wallet' ? ' <em>New</em>' : '') + '</span>' + I.chev + '</button>' : '<span class="p-mrow off"><span>' + it[1] + '</span>' + I.chev + '</span>')).join('') : '<p class="p-lead">Sign up to see your bookings, packages and wallet.</p>') +
        '</div><button class="p-scrim" data-a="c.menu" aria-label="Close menu"></button></div>'
      : '';
    $('c-phone').innerHTML =
      '<div class="p-status"><span>10:00</span><span>Client web app</span></div>' +
      '<div class="p-head">' + (backTo[scr] ? '<button class="p-ic" data-a="c.go" data-s="' + backTo[scr] + '" aria-label="Back">' + I.back + '</button>' : '<button class="p-ic" data-a="c.menu" aria-label="Menu">' + I.menu + '</button>') + '<strong>' + titles[scr] + '</strong><span class="p-ic"></span></div>' +
      '<div class="p-body" id="c-body" data-k="' + scr + '">' + body + '</div>' + drawer + cSheet(me) + (st.toast ? '<div class="p-toast ' + (st.toast.bad ? 'bad' : '') + '" role="status">' + esc(st.toast.msg) + '</div>' : '');

    const signedUp = S().db.Users.filter((u) => /^usr_\d/.test(u.id) && u.phone_verified_at);
    const people = [['usr_omar', 'Omar', 'has a gift card'], ['usr_salma', 'Salma', 'buys gift cards']].concat(signedUp.map((u) => [u.id, u.full_name.split(' ')[0], 'signed up in this demo'])).concat([['', 'New visitor', 'no account yet']]);
    $('c-persona').innerHTML = people.map((p) => '<button class="pill ' + ((st.me || '') === p[0] ? 'on' : '') + '" data-a="c.persona" data-id="' + p[0] + '"><b>' + esc(p[1]) + '</b><span>' + p[2] + '</span></button>').join('');
  }

  /* =====================================================================
   * BUSINESS APP
   * ===================================================================== */
  function bDashboard() {
    const bs = S().db.Bookings;
    const due = bs.filter((b) => b.payment_state === 'unpaid' && b.status === 'confirmed');
    const paid = bs.filter((b) => b.payment_state === 'paid' && (b.status === 'confirmed' || b.status === 'completed') && b.kind !== 'package').sort((a, b) => b.created_at - a.created_at).slice(0, 4);
    const row = (b, btn) => '<div class="p-card p-bk"><span class="p-gc-top"><b>' + esc(sim.user(b.user_id).full_name) + '</b><span>' + b2(b.price) + '</span></span><small>' + esc(b.title) + ' · ' + dt(b.starts_at) + '</small>' + (b.payment_state === 'paid' ? '<small>Paid: ' + paidSummary(b, b2) + '</small>' : '') + btn + '</div>';
    return (
      '<h5 class="p-h">Pending checkout</h5>' + (due.length ? due.map((b) => row(b, '<button class="p-btn small" data-a="b.checkout-ask" data-id="' + b.id + '">Checkout</button>')).join('') : '<p class="p-lead">Nobody is waiting to pay.</p>') +
      '<h5 class="p-h">Paid bookings</h5>' + (paid.length ? paid.map((b) => row(b, '<button class="p-btn ghost small" data-a="b.refund-ask" data-id="' + b.id + '">Cancel &amp; refund</button>')).join('') : '<p class="p-lead">No paid bookings.</p>')
    );
  }
  function bGiftCards() {
    const cs = sim.cards();
    return (
      '<button class="p-btn wide" data-a="b.go" data-s="assign"><span>Assign new gift card</span></button>' +
      cs.map((v) => '<button class="p-card p-gcrow" data-a="b.go" data-s="gcDetail" data-id="' + v.id + '"><span class="p-gc-top"><b>' + esc(v.recipient.name) + '</b>' + badge(v.status) + '</span><span class="p-gc-id">' + v.code + '</span><small>From ' + esc(v.sender.name) + ' · ' + dt(v.created_at) + '</small><small><b>' + b2(v.remaining) + '</b> left of ' + b2(v.amount) + '</small></button>').join('')
    );
  }
  function party(path, p, label) {
    const cl = sim.clients();
    let h = '<label class="p-label" for="' + path.replace(/\./g, '-') + '">' + label + '</label><select class="p-input" id="' + path.replace(/\./g, '-') + '" data-f="' + path + '.sel" data-r="1"><option value="">Select a client</option>' +
      cl.map((u) => '<option value="' + u.id + '"' + (p.sel === u.id ? ' selected' : '') + '>' + esc(u.full_name) + ' · ' + u.phone + '</option>').join('') + '<option value="new"' + (p.sel === 'new' ? ' selected' : '') + '>+ Add new client</option></select>';
    if (p.sel === 'new') {
      const id = path.replace(/\./g, '-');
      h += '<div class="p-newclient"><input class="p-input" id="' + id + '-n" data-f="' + path + '.name" value="' + esc(p.name) + '" placeholder="Full name" aria-label="Full name" autocomplete="off">' +
        '<input class="p-input" id="' + id + '-p" data-f="' + path + '.phone" value="' + esc(p.phone) + '" placeholder="WhatsApp number" aria-label="WhatsApp number" inputmode="tel" autocomplete="off">' +
        '<input class="p-input" id="' + id + '-e" data-f="' + path + '.email" value="' + esc(p.email) + '" placeholder="Email (optional)" aria-label="Email" inputmode="email" autocomplete="off"></div>';
    }
    return h;
  }
  function methodTiles(sel, action) {
    return '<div class="p-tiles2">' + [['cash_instapay_at_venue', 'Cash / InstaPay'], ['card_at_venue', 'Card']].map((m) => '<button class="p-tile ' + (sel === m[0] ? 'on' : '') + '" data-a="' + action + '" data-v="' + m[0] + '"><span><b>' + m[1] + '</b></span></button>').join('') + '</div>';
  }
  function bAssign() {
    const a = ui.b.as;
    const bulk = a.mode === 'bulk';
    const amt = Number(a.amount) || 0;
    let h = '<div class="p-seg"><button class="' + (!bulk ? 'on' : '') + '" data-a="b.assign-mode" data-v="single">One recipient</button><button class="' + (bulk ? 'on' : '') + '" data-a="b.assign-mode" data-v="bulk">Several recipients</button></div>';
    h += '<h5 class="p-h">' + (bulk ? 'Recipients' : 'Recipient') + '</h5>';
    a.recs.forEach((r, i) => {
      h += '<div class="p-recblock">' + party('b.as.recs.' + i, r, bulk ? 'Recipient ' + (i + 1) : 'Who is it for?') + (bulk && a.recs.length > 2 ? '<button class="p-link" data-a="b.del-rec" data-i="' + i + '">Remove</button>' : '') + '</div>';
    });
    if (bulk) h += '<button class="p-btn ghost small" data-a="b.add-rec">Add recipient</button>';
    h += '<h5 class="p-h">Who it came from</h5>' + party('b.as.sender', a.sender, 'Sender (a client or a company)');
    h += '<h5 class="p-h">Amount</h5><label class="p-label" for="ba-amt">' + (bulk ? 'Amount per gift card (EGP), the same for everyone' : 'Amount (EGP)') + '</label><input class="p-input" id="ba-amt" data-f="b.as.amount" value="' + esc(a.amount) + '" inputmode="numeric" autocomplete="off">';
    h += '<h5 class="p-h">Payment method</h5>' + methodTiles(a.method, 'b.method');
    h += '<div class="p-sum"><div class="tot"><span>' + (bulk ? a.recs.length + ' gift cards × ' + b2(amt) : 'Amount paid') + '</span><span>' + b2(amt * a.recs.length) + '</span></div></div>';
    h += '<button class="p-btn wide" data-a="b.assign-save"><span>Complete Payment</span></button>';
    return h;
  }
  function bGcDetail() {
    const card = S().db.GiftCards.find((x) => x.id === ui.b.params.id);
    const v = sim.cardView(card);
    const t = S().db.PaymentTransactions.find((x) => x.id === card.payment_transaction_id);
    const canVoid = (card.status === 'active' || card.status === 'pending_claim') && v.remaining > 0;
    return (
      '<div class="p-card p-gcd"><span class="p-gc-top"><span class="p-gc-id">' + v.code + '</span>' + badge(v.status) + '</span>' +
      '<div class="p-gc-nums"><span>Original<b>' + b2(v.amount) + '</b></span><span>Used<b>' + b2(v.used) + '</b></span><span>Remaining<b>' + b2(v.remaining) + '</b></span></div></div>' +
      '<div class="p-kv"><div><span>Recipient</span><b>' + esc(v.recipient.name) + '<small>' + v.recipient.phone + '</small></b></div><div><span>From</span><b>' + esc(v.sender.name) + '</b></div>' +
      '<div><span>Sold</span><b>' + (v.channel === 'online' ? 'Bought in the client app' : 'Front desk sale') + '<small>' + sim.METHOD_LABEL[t.payment_method] + ' · ' + dt(v.created_at) + '</small></b></div>' +
      (v.expires_at ? '<div><span>Credit expires</span><b>' + dt(v.expires_at) + '</b></div>' : '') +
      (card.status === 'voided' ? '<div><span>Voided</span><b>' + dt(card.voided_at) + '<small>' + b2(card.void_refund_amount) + ' refunded to ' + (card.void_refund_destination === 'wallet' ? "the sender's wallet" : 'the original method of payment') + '</small></b></div>' : '') + '</div>' +
      '<h5 class="p-h">Usage</h5>' + usageList(v, b2) + (canVoid ? '<button class="p-btn ghost wide" data-a="b.void-ask"><span>Void or refund</span></button>' : '')
    );
  }
  function bClients() {
    return '<div class="p-search">Search here</div>' + sim.clients().map((u) => '<button class="p-crow" data-a="b.go" data-s="client" data-id="' + u.id + '"><i>' + esc(u.full_name.split(' ').map((w) => w[0]).slice(0, 2).join('')) + '</i><span><b>' + esc(u.full_name) + '</b><small>' + u.phone + '</small></span>' + I.chev + '</button>').join('');
  }
  function bClient() {
    const u = sim.user(ui.b.params.id);
    const w = sim.walletView(u.id);
    return (
      '<div class="p-seg"><button class="on">Client Profile</button><button disabled>Client history</button></div>' +
      '<div class="p-kv"><div><span>First and last name</span><b>' + esc(u.full_name) + '</b></div><div><span>Mobile phone</span><b>' + u.phone + '</b></div>' + (u.email ? '<div><span>Email</span><b>' + esc(u.email) + '</b></div>' : '') + '</div>' +
      (w.activity.length ? '<h5 class="p-h">Wallet</h5><div class="p-card p-walletrow"><span>Balance<small>' + (w.next_expiry ? b2(w.next_expiry.amount) + ' expires ' + dt(w.next_expiry.expires_at) : 'Nothing to spend') + '</small></span><b>' + b2(w.balance) + '</b></div>' : '') +
      (w.gift_cards.length ? '<h5 class="p-h">Gift cards</h5>' + w.gift_cards.map((v) => '<button class="p-card p-gcrow" data-a="b.go" data-s="gcDetail" data-id="' + v.id + '"><span class="p-gc-top"><b>From ' + esc(v.sender.name) + '</b>' + badge(v.status) + '</span><span class="p-gc-id">' + v.code + '</span><span class="p-gc-nums"><span>Original<b>' + b2(v.amount) + '</b></span><span>Used<b>' + b2(v.used) + '</b></span><span>Remaining<b>' + b2(v.remaining) + '</b></span></span></button>').join('') : '')
    );
  }
  function bMenu() {
    const sec = [
      ['Clients', [['clients', 'Member profiles']]],
      ['Business management', [['', 'Business information'], ['', 'Offerings'], ['billing', 'Billing & payment']]],
      ['Marketing', [['', 'Packages'], ['giftcards', 'Gift cards', 1], ['', 'Marketing Campaigns']]],
      ['Data & Analytics', [['', 'Payment transactions']]],
    ];
    return sec.map((s) => '<h5 class="p-mh">' + s[0] + '</h5>' + s[1].map((r) => (r[0] ? '<button class="p-mrow" data-a="b.go" data-s="' + r[0] + '"><span>' + esc(r[1]) + (r[2] ? ' <em>New</em>' : '') + '</span>' + I.chev + '</button>' : '<span class="p-mrow off"><span>' + esc(r[1]) + '</span>' + I.chev + '</span>')).join('')).join('');
  }
  function bBilling() {
    const rows = [['', 'Accept online payments'], ['', 'Cancellation & Refund Policy'], ['walletcfg', 'Wallet configuration', 1], ['', 'Payment Transactions'], ['', 'Additional booking notes']];
    return '<p class="p-lead">View your bills and invoices and configure how your business accepts online payments.</p><h5 class="p-mh">Client payments</h5>' + rows.map((r) => (r[0] ? '<button class="p-mrow" data-a="b.go" data-s="' + r[0] + '"><span>' + esc(r[1]) + ' <em>New</em></span>' + I.chev + '</button>' : '<span class="p-mrow off"><span>' + esc(r[1]) + '</span>' + I.chev + '</span>')).join('');
  }
  function bWalletCfg() {
    const c = ui.b.cfg;
    return (
      '<h5 class="p-h">Refunds</h5><button class="p-switchrow" data-a="b.cfg-toggle" role="switch" aria-checked="' + !!c.on + '"><span><b>Send online refunds to the client\'s wallet</b><small>When on, a refund of an online payment is added to the client\'s wallet and not returned to their card. Payments recorded by staff are not affected.</small></span><i class="p-switch ' + (c.on ? 'on' : '') + '"></i></button>' +
      '<div class="p-note">Your cancellation policy still decides how much is refunded. This decides where it goes. Staff are asked each time they refund by hand, with this as the preselected answer.</div>' +
      '<h5 class="p-h">Expiry</h5><div class="p-stepper"><span><b>Wallet credit expires after</b><small>Counted from the day the credit is added</small></span><div><button data-a="b.cfg-dec" aria-label="One month less">−</button><b>' + c.months + ' mo</b><button data-a="b.cfg-inc" aria-label="One month more">+</button></div></div>' +
      '<div class="p-note">Applies to credit added from now on. Credit already in wallets keeps its date.</div><button class="p-btn wide" data-a="b.cfg-save"><span>Save</span></button>'
    );
  }
  function destTiles(sel, wTitle, wDesc, oDesc) {
    return '<button class="p-tile ' + (sel === 'wallet' ? 'on' : '') + '" data-a="b.dest" data-v="wallet"><span><b>Wallet</b><small>' + wDesc + '</small></span></button>' +
      '<button class="p-tile ' + (sel === 'original_method' ? 'on' : '') + '" data-a="b.dest" data-v="original_method"><span><b>Original method of payment</b><small>' + oDesc + '</small></span></button>';
  }
  function bSheet() {
    const sh = ui.b.sheet;
    if (!sh) return '';
    const months = S().db.BusinessWalletConfigs[0].credit_expiry_months;
    let h = '';
    if (sh.type === 'void') {
      const card = S().db.GiftCards.find((x) => x.id === sh.id);
      const v = sim.cardView(card);
      const t = S().db.PaymentTransactions.find((x) => x.id === card.payment_transaction_id);
      h = '<h4>Refund to wallet or to original method of payment?</h4><p>' + b2(v.remaining) + ' is left on ' + v.code + '. Voiding ' + (card.status === 'active' ? 'takes it out of ' + esc(v.recipient.name) + "'s wallet and " : '') + 'refunds ' + esc(v.sender.name) + '.</p>' +
        destTiles(sh.dest, '', 'Add ' + b2(v.remaining) + ' to ' + esc(v.sender.name) + "'s wallet. Expires in " + months + ' months.', t.payment_gateway ? 'Paymob refund to the card that paid online.' : sim.METHOD_LABEL[t.payment_method] + ': hand back ' + b2(v.remaining) + ' and record it.') +
        '<button class="p-btn wide" data-a="b.void-do"><span>Void gift card</span></button><button class="p-btn ghost wide" data-a="b.sheet-close"><span>Keep gift card</span></button>';
    } else if (sh.type === 'refund') {
      const b = S().db.Bookings.find((x) => x.id === sh.id);
      const ts = txnsOf(b).filter((t) => t.payment_status === 'completed');
      const w = ts.filter((t) => t.payment_method === 'wallet').reduce((s, t) => s + t.amount, 0);
      const other = ts.filter((t) => t.payment_method !== 'wallet');
      const o = other.reduce((s, t) => s + t.amount, 0);
      const cl = sim.user(b.user_id).full_name;
      h = '<h4>Refund to wallet or to original method of payment?</h4><p>Cancelling ' + esc(b.title) + ' for ' + esc(cl) + '.</p>' +
        (w > 0 ? '<div class="p-note">' + b2(w) + ' was paid from the wallet. It goes back to the wallet either way.</div>' : '') +
        (o > 0 ? destTiles(sh.dest, '', 'Add ' + b2(o) + ' to ' + esc(cl) + "'s wallet. Expires in " + months + ' months.', other[0].payment_gateway ? 'Paymob refund of ' + b2(o) + ' to the card.' : sim.METHOD_LABEL[other[0].payment_method] + ': hand back ' + b2(o) + ' and record it.') : '') +
        '<button class="p-btn wide" data-a="b.refund-do"><span>Refund &amp; Cancel</span></button><button class="p-btn ghost wide" data-a="b.sheet-close"><span>Keep booking</span></button>';
    } else if (sh.type === 'co') {
      const b = S().db.Bookings.find((x) => x.id === sh.id);
      const bal = sim.balance(b.user_id);
      const w = sh.useWallet ? Math.min(bal, b.price) : 0;
      const due = b.price - w;
      h = '<h4>Checkout &amp; Complete</h4><p>Review the final details for your client.</p><div class="p-sum box"><div><span>Total Service</span><span>' + b2(b.price) + '</span></div>' +
        (w > 0 ? '<div class="plus"><span>Wallet</span><span>−' + b2(w) + '</span></div>' : '') + '<div class="tot"><span>Balance Due</span><span>' + b2(due) + '</span></div></div>' +
        (bal > 0 ? '<button class="p-switchrow" data-a="b.co-wallet" role="switch" aria-checked="' + !!sh.useWallet + '"><span><b>Use client\'s wallet</b><small>' + b2(bal) + ' available · used first</small></span><i class="p-switch ' + (sh.useWallet ? 'on' : '') + '"></i></button>' : '') +
        (due > 0 ? '<h5 class="p-h">Payment Method</h5>' + methodTiles(sh.method, 'b.co-method') : '') +
        '<button class="p-btn wide" data-a="b.co-do"><span>Complete Payment</span></button><button class="p-btn ghost wide" data-a="b.sheet-close"><span>Not now</span></button>';
    }
    return '<div class="p-sheet"><div class="p-sheet-card">' + h + '</div></div>';
  }
  function renderB() {
    const st = ui.b;
    const titles = { dashboard: 'Dashboard', giftcards: 'Gift cards', assign: 'Assign new gift card', gcDetail: 'Gift card', clients: 'Client members', client: 'Client', menu: 'Menu', billing: 'Billing & Payment', walletcfg: 'Wallet configuration' };
    const backTo = { assign: 'giftcards', gcDetail: st.params.from || 'giftcards', client: 'clients', clients: 'menu', giftcards: 'menu', billing: 'menu', walletcfg: 'billing' };
    const fn = { dashboard: bDashboard, giftcards: bGiftCards, assign: bAssign, gcDetail: bGcDetail, clients: bClients, client: bClient, menu: bMenu, billing: bBilling, walletcfg: bWalletCfg };
    const nav = [['dashboard', 'Dashboard', I.grid], ['', 'Calendar', I.cal], ['', 'Analytics', I.chart], ['menu', 'Menu', I.menu]];
    const inMenu = st.screen !== 'dashboard';
    $('b-phone').innerHTML =
      '<div class="p-status"><span>10:00</span><span>Business app · Mona, front desk</span></div>' +
      '<div class="p-head">' + (backTo[st.screen] ? '<button class="p-ic" data-a="b.go" data-s="' + backTo[st.screen] + '" data-id="' + (st.screen === 'gcDetail' && st.params.from === 'client' ? st.params.client : '') + '" aria-label="Back">' + I.back + '</button>' : '<span class="p-ic"></span>') + '<strong>' + esc(titles[st.screen]) + '</strong><span class="p-ic"></span></div>' +
      '<div class="p-body scaffold" id="b-body" data-k="' + st.screen + '">' + fn[st.screen]() + '</div>' +
      '<div class="p-nav">' + nav.map((n) => (n[0] ? '<button class="' + ((n[0] === 'menu') === inMenu ? 'on' : '') + '" data-a="b.go" data-s="' + n[0] + '">' + n[2] + '<span>' + n[1] + '</span></button>' : '<span class="off">' + n[2] + '<span>' + n[1] + '</span></span>')).join('') + '</div>' +
      bSheet() + (st.toast ? '<div class="p-toast up ' + (st.toast.bad ? 'bad' : '') + '" role="status">' + esc(st.toast.msg) + '</div>' : '');
  }

  /* =====================================================================
   * INSPECTOR: API log + database
   * ===================================================================== */
  const TABLES = {
    WalletLedgers: ['changed', ['id', 'user_id', 'entry_type', 'reason', 'amount', 'remaining_amount', 'status', 'expires_at', 'gift_card_id', 'reference_id', 'created_at']],
    WalletLedgerAllocations: ['new', ['id', 'debit_entry_id', 'lot_id', 'gift_card_id', 'amount', 'created_at']],
    GiftCards: ['new', ['id', 'code', 'amount', 'recipient_phone', 'recipient_user_id', 'sender_user_id', 'channel', 'status', 'claimed_at', 'void_refund_destination', 'created_at']],
    GiftCardOrders: ['new', ['id', 'sender_user_id', 'channel', 'card_amount', 'quantity', 'total_amount', 'payment_transaction_id', 'status', 'created_at']],
    PaymentTransactions: ['changed', ['id', 'transaction_reference', 'user_id', 'booking_type', 'booking_id', 'payment_method', 'amount', 'payment_status', 'created_at']],
    PaymentRefunds: ['changed', ['id', 'payment_transaction_id', 'refund_amount', 'refund_type', 'refund_destination', 'wallet_ledger_id', 'refund_status', 'created_at']],
    BusinessWalletConfigs: ['new', ['business_id', 'refund_to_wallet_enabled', 'credit_expiry_months', 'updated_at']],
    Users: ['existing', ['id', 'full_name', 'phone', 'role', 'phone_verified_at']],
  };
  function pretty(obj) {
    return esc(JSON.stringify(obj, (k, v) => (k === '_t' ? undefined : typeof v === 'number' && (k === 'at' || /_at$/.test(k)) ? new Date(v).toISOString() : v), 2));
  }
  function cell(k, v) {
    if (v === null || v === undefined) return '<span class="nil">null</span>';
    if (/_at$/.test(k)) return dt(v);
    return esc(v);
  }
  function renderInspector() {
    const st = S();
    const lw = lastWrite();
    const hot = lw && lw.n > st.seedTicks ? lw : null;
    let h = '<div class="insp-tabs"><button class="' + (ui.insp === 'api' ? 'on' : '') + '" data-a="g.insp" data-v="api">API calls <span>' + st.log.length + '</span></button><button class="' + (ui.insp === 'db' ? 'on' : '') + '" data-a="g.insp" data-v="db">Database' + (hot ? ' <span class="dot">' + hot.tables.length + ' changed</span>' : '') + '</button></div>';
    if (ui.insp === 'api') {
      h += '<div class="calls">' + st.log.slice().reverse().map((r) => {
        const open = ui.openLog === r.n;
        return (
          '<div class="call ' + (r.ok ? '' : 'err ') + (open ? 'open' : '') + '"><button class="call-h" data-a="g.log" data-n="' + r.n + '" aria-expanded="' + open + '"><span class="who who-' + r.actor + '">' + WHO[r.actor] + '</span><span class="verb">' + r.method + '</span><code>' + esc(r.path) + '</code><span class="st">' + r.status + '</span></button>' +
          (open
            ? '<div class="call-b"><small>' + dt(r.at) + (r.n <= st.seedTicks ? ' · sample history' : '') + '</small>' +
              (r.request ? '<h6>Request body</h6><pre>' + pretty(r.request) + '</pre>' : '') + '<h6>Response</h6><pre>' + pretty(r.response) + '</pre>' +
              (r.effects.length ? '<h6>Messages sent</h6><ul>' + r.effects.map((e) => '<li>' + esc(e) + '</li>').join('') + '</ul>' : '') +
              (r.tables.length ? '<h6>Tables written, in one transaction</h6><p class="tchips">' + r.tables.map((t) => '<button data-a="g.table" data-t="' + t + '">' + t + '</button>').join('') + '</p>' : r.ok ? '' : '<h6>Database</h6><p>Rolled back. Nothing was written.</p>') + '</div>'
            : '') + '</div>'
        );
      }).join('') + '</div>';
    } else {
      const names = Object.keys(TABLES);
      const cols = TABLES[ui.table][1];
      const rows = st.db[ui.table];
      h += '<div class="tpick">' + names.map((n) => '<button class="' + (ui.table === n ? 'on ' : '') + (hot && hot.tables.indexOf(n) >= 0 ? 'hot' : '') + '" data-a="g.table" data-t="' + n + '">' + n + ' <span>' + st.db[n].length + '</span></button>').join('') + '</div>' +
        '<p class="tnote"><span class="tk ' + TABLES[ui.table][0] + '">' + ({ new: 'New table', changed: 'Existing table, extended', existing: 'Existing table' }[TABLES[ui.table][0]]) + '</span>' + (hot ? ' Highlighted rows were written by the last change.' : ' Showing sample history.') + '</p>' +
        '<div class="scroll dbscroll"><table class="db"><thead><tr>' + cols.map((c) => '<th>' + c + '</th>').join('') + '</tr></thead><tbody>' +
        (rows.length ? rows.slice().reverse().map((r) => '<tr class="' + (hot && r._t === hot.n ? 'hot' : '') + '">' + cols.map((c) => '<td>' + cell(c, r[c]) + '</td>').join('') + '</tr>').join('') : '<tr><td colspan="' + cols.length + '">No rows yet.</td></tr>') + '</tbody></table></div>';
    }
    $('inspector').innerHTML = h;
  }

  /* ---------- render all, keeping scroll positions ---------- */
  function render() {
    const keep = {};
    ['c-body', 'b-body'].forEach((id) => {
      const el = $(id);
      if (el) keep[id] = [el.dataset.k, el.scrollTop];
    });
    renderC();
    renderB();
    renderInspector();
    ['c-body', 'b-body'].forEach((id) => {
      const el = $(id);
      if (el && keep[id] && keep[id][0] === el.dataset.k) el.scrollTop = keep[id][1];
    });
    $('demo').dataset.view = ui.view;
    document.querySelectorAll('[data-a="g.view"]').forEach((b) => b.classList.toggle('on', b.dataset.v === ui.view));
    $('demo-date').textContent = dt(S().now);
    const cfg = S().db.BusinessWalletConfigs[0];
    $('demo-cfg').textContent = 'Online refunds go to: ' + (cfg.refund_to_wallet_enabled ? 'wallet' : 'card') + ' · Credit expires after ' + cfg.credit_expiry_months + ' months';
  }

  /* =====================================================================
   * ACTIONS
   * ===================================================================== */
  const A = {
    /* ----- page ----- */
    'g.view': (d) => (ui.view = d.v),
    'g.insp': (d) => (ui.insp = d.v),
    'g.log': (d) => (ui.openLog = ui.openLog === Number(d.n) ? null : Number(d.n)),
    'g.table': (d) => {
      ui.table = d.t;
      ui.insp = 'db';
    },
    'g.advance': (d) => {
      const rec = sim.advance(Number(d.d));
      if (rec) {
        ui.openLog = rec.n;
        toastC(c2(rec.response.expired_amount) + ' of wallet credit expired.', true);
      } else toastC('Moved to ' + dt(S().now) + '. Nothing expired.');
      ui.c.sheet = null;
      ui.b.sheet = null;
    },
    'g.reset': () => {
      sim = window.WalletSim.create();
      ui = fresh();
    },
    'g.scn': (d) => {
      const n = Number(d.n);
      ui.c.sheet = ui.b.sheet = null;
      ui.c.menu = false;
      if (n === 1) {
        ui.view = 'c';
        ui.c.me = 'usr_salma';
        ui.c.screen = 'gift';
        ui.c.gift = { name: 'Layla Ibrahim', phone: '+20 100 000 0199', email: 'layla@example.com', amount: '500' };
      } else if (n === 2) {
        ui.view = 'c';
        ui.c.me = null;
        ui.c.su = { name: 'Layla Ibrahim', phone: '+20 100 000 0199' };
      } else if (n === 3) {
        ui.view = 'c';
        ui.c.me = 'usr_omar';
        ui.c.screen = 'checkout';
        ui.c.params = { id: 'svc_massage' };
        ui.c.co = { pay: 'online', useWallet: true };
      } else if (n === 4) {
        ui.view = 'b';
        ui.b.screen = 'assign';
        ui.b.as = { mode: 'bulk', recs: [{ sel: 'new', name: 'Hana Sherif', phone: '+20 100 000 0120', email: '' }, { sel: 'new', name: 'Youssef Nabil', phone: '+20 100 000 0121', email: '' }], sender: { sel: 'usr_delta', name: '', phone: '', email: '' }, amount: '750', method: 'card_at_venue' };
      } else if (n === 5) {
        const c = S().db.GiftCards.find((x) => x.channel === 'admin' && x.status === 'active') || S().db.GiftCards.find((x) => x.status === 'active' || x.status === 'pending_claim');
        ui.view = 'b';
        if (c) {
          ui.b.screen = 'gcDetail';
          ui.b.params = { id: c.id };
        } else {
          ui.b.screen = 'giftcards';
          toastB('Every gift card is already used or voided. Reset the demo to try this.', true);
        }
      } else if (n === 6) {
        ui.view = 'b';
        ui.b.screen = 'walletcfg';
        const cf = S().db.BusinessWalletConfigs[0];
        ui.b.cfg = { on: true, months: cf.credit_expiry_months };
        ui.c.me = 'usr_omar';
        ui.c.screen = 'bookings';
      } else if (n === 7) {
        ui.view = 'b';
        ui.b.screen = 'dashboard';
        const b = S().db.Bookings.find((x) => x.payment_state === 'unpaid' && x.status === 'confirmed');
        if (b) ui.b.sheet = { type: 'co', id: b.id, useWallet: true, method: 'cash_instapay_at_venue' };
        else toastB('Nobody is waiting to pay. Reset the demo to try this.', true);
      }
      const el = $('demo');
      if (el && el.scrollIntoView) el.scrollIntoView({ block: 'start' });
    },

    /* ----- client app ----- */
    'c.menu': () => (ui.c.menu = !ui.c.menu),
    'c.persona': (d) => {
      ui.c.me = d.id || null;
      ui.c.screen = 'home';
      ui.c.sheet = null;
      ui.c.menu = false;
    },
    'c.tab': (d) => (ui.c.tab = d.k),
    'c.go': (d) => {
      const st = ui.c;
      st.menu = false;
      st.sheet = null;
      st.screen = d.s;
      if (d.id) st.params = { id: d.id };
      if (d.s === 'wallet') api('client.wallet', {}, 'b2c', st.me);
      if (d.s === 'card') api('client.giftCard', { id: d.id }, 'b2c', st.me);
    },
    'c.book': (d) => {
      const s = sim.service(d.id);
      ui.c.screen = 'checkout';
      ui.c.params = { id: d.id };
      ui.c.co = { pay: ownedPackage(ui.c.me, s) ? 'package' : 'online', useWallet: sim.balance(ui.c.me) > 0 };
    },
    'c.pay': (d) => (ui.c.co.pay = d.v),
    'c.wallet-toggle': () => (ui.c.co.useWallet = !ui.c.co.useWallet),
    'c.checkout': () => {
      const st = ui.c;
      const s = sim.service(st.params.id);
      const pk = ownedPackage(st.me, s);
      const body = pk && st.co.pay === 'package' ? { business_id: sim.BIZ, service_id: s.id, client_package_id: pk.id } : { business_id: sim.BIZ, service_id: s.id, use_wallet: !!st.co.useWallet && sim.balance(st.me) > 0 };
      const rec = api('client.checkout', body, 'b2c', st.me);
      if (!rec.ok) return toastC(rec.response.error, true);
      const r = rec.response;
      if (r.booked) {
        st.screen = 'done';
        st.params = { kind: 'booking', id: r.booking_id };
      } else st.sheet = { type: 'pay', what: 'booking', txn: r.payment.transaction_id, amount: r.payment.amount, held: r.wallet.applied, booking: r.booking_id };
    },
    'c.gift-amt': (d) => (ui.c.gift.amount = d.v),
    'c.gift-buy': () => {
      const g = ui.c.gift;
      const rec = api('client.buyGiftCard', { recipient: { name: g.name, phone: g.phone, email: g.email }, amount: Number(g.amount) || 0 }, 'b2c', ui.c.me);
      if (!rec.ok) return toastC(rec.response.error, true);
      ui.c.sheet = { type: 'pay', what: 'gift', txn: rec.response.payment.transaction_id, amount: rec.response.payment.amount, held: 0 };
    },
    'c.pay-approve': () => {
      const sh = ui.c.sheet;
      const rec = api('gateway.webhook', { transaction_id: sh.txn, success: true }, 'system', null);
      ui.c.sheet = null;
      ui.c.screen = 'done';
      if (sh.what === 'gift') {
        ui.c.params = { kind: 'gift', id: rec.response.gift_cards[0].id };
        ui.c.gift = { name: '', phone: '', email: '', amount: '500' };
      } else ui.c.params = { kind: 'booking', id: sh.booking };
    },
    'c.pay-decline': () => {
      const sh = ui.c.sheet;
      api('gateway.webhook', { transaction_id: sh.txn, success: false }, 'system', null);
      ui.c.sheet = null;
      toastC(sh.held > 0 ? 'Payment declined. ' + c2(sh.held) + ' is back in your wallet.' : 'Payment declined. Nothing was charged.', true);
    },
    'c.cancel-ask': (d) => (ui.c.sheet = { type: 'cancel', id: d.id }),
    'c.cancel-do': () => {
      const b = S().db.Bookings.find((x) => x.id === ui.c.sheet.id);
      const rec = api('client.cancelBooking', { id: b.id, kind: b.kind }, 'b2c', ui.c.me);
      if (!rec.ok) {
        ui.c.sheet = null;
        return toastC(rec.response.error, true);
      }
      const lines = rec.response.refund.parts.map((p) => {
        if (p.method === 'package') return { text: 'Your package session was returned.' };
        if (p.destination === 'wallet') return { wallet: true, text: c2(p.amount) + ' went to your wallet, not to your card.' + (p.expires_at ? ' Use it by ' + dt(p.expires_at) + '.' : '') };
        return { text: c2(p.amount) + ' was refunded to your card.' };
      });
      ui.c.sheet = { type: 'refunded', lines };
    },
    'c.sheet-close': () => (ui.c.sheet = null),
    'c.signup': () => {
      const rec = api('auth.verifyPhone', { name: ui.c.su.name, phone: ui.c.su.phone }, 'b2c', null);
      if (!rec.ok) return toastC(rec.response.error, true);
      const r = rec.response;
      ui.c.me = r.user_id;
      ui.c.screen = r.claimed_gift_cards.length ? 'wallet' : 'home';
      ui.c.su = { name: '', phone: '' };
      toastC(r.claimed_gift_cards.length ? 'A ' + c2(r.claimed_gift_cards.reduce((s, c) => s + c.amount, 0)) + ' gift card was waiting for you. It is in your wallet.' : 'Welcome. No gift cards were waiting for this number.');
    },

    /* ----- business app ----- */
    'b.go': (d) => {
      const st = ui.b;
      const from = st.screen;
      st.sheet = null;
      st.screen = d.s;
      if (d.s === 'gcDetail') {
        st.params = { id: d.id, from: from === 'client' ? 'client' : 'giftcards', client: from === 'client' ? st.params.id : null };
        api('biz.giftCard', { id: d.id }, 'b2b', st.me);
      } else if (d.s === 'client') {
        st.params = { id: d.id };
        api('biz.clientWallet', { client_id: d.id }, 'b2b', st.me);
      } else if (d.s === 'giftcards') api('biz.giftCards', {}, 'b2b', st.me);
      else if (d.s === 'assign') st.as = blankAssign('single');
      else if (d.s === 'walletcfg') {
        const rec = api('biz.getWalletSettings', {}, 'b2b', st.me);
        st.cfg = { on: rec.response.refund_to_wallet_enabled, months: rec.response.credit_expiry_months };
      }
    },
    'b.assign-mode': (d) => {
      const a = ui.b.as;
      a.mode = d.v;
      if (d.v === 'bulk' && a.recs.length < 2) a.recs.push(blankParty());
      if (d.v === 'single') a.recs = [a.recs[0]];
    },
    'b.add-rec': () => ui.b.as.recs.push(blankParty()),
    'b.del-rec': (d) => ui.b.as.recs.splice(Number(d.i), 1),
    'b.method': (d) => (ui.b.as.method = d.v),
    'b.assign-save': () => {
      const a = ui.b.as;
      const toParty = (p) => (p.sel === 'new' ? { name: p.name, phone: p.phone, email: p.email || null } : p.sel ? { client_id: p.sel } : null);
      let rec;
      if (a.mode === 'bulk') rec = api('biz.assignGiftCardsBulk', { sender: toParty(a.sender), recipients: a.recs.map(toParty), amount: Number(a.amount) || 0, payment_method_slug: a.method }, 'b2b', ui.b.me);
      else rec = api('biz.assignGiftCard', { recipient: toParty(a.recs[0]), sender: toParty(a.sender), amount: Number(a.amount) || 0, payment_method_slug: a.method }, 'b2b', ui.b.me);
      if (!rec.ok) return toastB(rec.response.error, true);
      if (a.mode === 'bulk') {
        ui.b.screen = 'giftcards';
        toastB(rec.response.gift_cards.length + ' gift cards created. ' + b2(rec.response.total_amount) + ' recorded as one payment.');
      } else {
        ui.b.screen = 'gcDetail';
        ui.b.params = { id: rec.response.gift_card.id, from: 'giftcards' };
        toastB('Gift card ' + rec.response.gift_card.code + ' created.');
      }
      ui.b.as = blankAssign('single');
    },
    'b.void-ask': () => (ui.b.sheet = { type: 'void', id: ui.b.params.id, dest: S().db.BusinessWalletConfigs[0].refund_to_wallet_enabled ? 'wallet' : 'original_method' }),
    'b.dest': (d) => (ui.b.sheet.dest = d.v),
    'b.void-do': () => {
      const sh = ui.b.sheet;
      const rec = api('biz.voidGiftCard', { id: sh.id, refund_destination: sh.dest, reason: 'Requested by the buyer' }, 'b2b', ui.b.me);
      ui.b.sheet = null;
      if (!rec.ok) return toastB(rec.response.error, true);
      toastB('Voided. ' + b2(rec.response.refund.amount) + ' refunded to ' + (sh.dest === 'wallet' ? rec.response.refund.to + "'s wallet." : 'the original method of payment.'));
    },
    'b.checkout-ask': (d) => (ui.b.sheet = { type: 'co', id: d.id, useWallet: true, method: 'cash_instapay_at_venue' }),
    'b.co-wallet': () => (ui.b.sheet.useWallet = !ui.b.sheet.useWallet),
    'b.co-method': (d) => (ui.b.sheet.method = d.v),
    'b.co-do': () => {
      const sh = ui.b.sheet;
      const b = S().db.Bookings.find((x) => x.id === sh.id);
      const w = sh.useWallet ? Math.min(sim.balance(b.user_id), b.price) : 0;
      const rec = api('biz.completeCheckout', { id: b.id, payment_method_slug: sh.method, amount_paid: b.price - w, wallet_amount: w }, 'b2b', ui.b.me);
      ui.b.sheet = null;
      if (!rec.ok) return toastB(rec.response.error, true);
      toastB('Checked out. ' + rec.response.paid.map((p) => sim.METHOD_LABEL[p.method] + ' ' + b2(p.amount)).join(' + ') + '.');
    },
    'b.refund-ask': (d) => (ui.b.sheet = { type: 'refund', id: d.id, dest: S().db.BusinessWalletConfigs[0].refund_to_wallet_enabled ? 'wallet' : 'original_method' }),
    'b.refund-do': () => {
      const sh = ui.b.sheet;
      const rec = api('biz.refundCancel', { id: sh.id, refund_behavior: 'full', refund_destination: sh.dest }, 'b2b', ui.b.me);
      ui.b.sheet = null;
      if (!rec.ok) return toastB(rec.response.error, true);
      const r = rec.response.refund;
      const w = r.to_wallet + r.returned_to_wallet;
      toastB('Cancelled. ' + [w > 0 ? b2(w) + ' to the wallet' : '', r.to_original_method > 0 ? b2(r.to_original_method) + ' to the original method' : ''].filter(Boolean).join(', ') + '.');
    },
    'b.cfg-toggle': () => (ui.b.cfg.on = !ui.b.cfg.on),
    'b.cfg-dec': () => (ui.b.cfg.months = Math.max(1, ui.b.cfg.months - 1)),
    'b.cfg-inc': () => (ui.b.cfg.months = Math.min(36, ui.b.cfg.months + 1)),
    'b.cfg-save': () => {
      const rec = api('biz.putWalletSettings', { refund_to_wallet_enabled: ui.b.cfg.on, credit_expiry_months: ui.b.cfg.months }, 'b2b', ui.b.me);
      if (!rec.ok) return toastB(rec.response.error, true);
      toastB('Saved. Online refunds go to the ' + (ui.b.cfg.on ? 'wallet' : 'card') + '. New credit expires after ' + ui.b.cfg.months + ' months.');
    },
    'b.sheet-close': () => (ui.b.sheet = null),
  };

  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-a]');
    if (!el || !A[el.dataset.a]) return;
    e.preventDefault();
    ui.c.toast = null;
    ui.b.toast = null;
    A[el.dataset.a](el.dataset);
    render();
  });
  document.addEventListener('input', (e) => {
    const el = e.target;
    if (el.dataset && el.dataset.f && !el.dataset.r) setPath(el.dataset.f, el.value);
  });
  document.addEventListener('change', (e) => {
    const el = e.target;
    if (el.dataset && el.dataset.f && el.dataset.r) {
      setPath(el.dataset.f, el.value);
      render();
    }
  });

  render();
})();
