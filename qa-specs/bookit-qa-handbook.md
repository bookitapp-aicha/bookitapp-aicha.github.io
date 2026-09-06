# Bookit — Platform Introduction & QA Onboarding Guide

> **Audience:** New QA Tester joining the Bookit team.
> **Goal:** By the end of this document you should understand what Bookit is, how the pieces fit together, where the risky areas are, and what to test in your first week.
> **Last verified against source:** B2B mobile `v1.0.84+167`, B2C `bookit-b2c@0.1.0`, API (`bookit-api`, 29 modules / ~343 routes).

---

## Table of Contents

1. [What is Bookit?](#1-what-is-bookit)
2. [The Product Family — the three surfaces](#2-the-product-family--the-three-surfaces)
3. [Core Domain Concepts (learn these first)](#3-core-domain-concepts-learn-these-first)
4. [The B2B App (Business / Merchant side)](#4-the-b2b-app-business--merchant-side)
5. [The B2C App (Customer side)](#5-the-b2c-app-customer-side)
6. [The API (the shared brain)](#6-the-api-the-shared-brain)
7. [Environments, URLs & Builds](#7-environments-urls--builds)
8. [Roles, Capabilities & Permissions](#8-roles-capabilities--permissions)
9. [State Machines — the statuses you must memorise](#9-state-machines--the-statuses-you-must-memorise)
10. [High-Risk Areas — where the bugs live](#10-high-risk-areas--where-the-bugs-live)
11. [Your First Week — a concrete plan](#11-your-first-week--a-concrete-plan)
12. [Smoke Test Suite (run this before every release)](#12-smoke-test-suite-run-this-before-every-release)
13. [How to Write a Bookit Bug Report](#13-how-to-write-a-bookit-bug-report)
14. [Tooling, Test Suites & Useful Commands](#14-tooling-test-suites--useful-commands)
15. [Glossary](#15-glossary)

---

## 1. What is Bookit?

**Bookit is a booking and business-operations platform for Health, Wellness, Beauty, and Fitness establishments.**

Think of a yoga studio, a physiotherapy clinic, a hair salon, a gym, or a spa. Before Bookit, they run on WhatsApp messages, a paper diary, and a lot of hope. Bookit gives them:

| Capability | What it means in practice |
|---|---|
| **Booking management** | A calendar showing every appointment and class, per location, per staff member. |
| **Online booking link** | A public page customers can book from — no app install required. |
| **Online payments** | Card payments, deposits, and payment links via Paymob and Kashier gateways. |
| **Customer retention** | Client profiles, visit history, packages/memberships, and marketing campaigns. |
| **Staff management** | Staff profiles, per-location schedules, time-off, service assignment, leaderboards. |
| **QR check-in / check-out** | Staff scan a customer's QR code to mark them arrived / checked in. |
| **Analytics** | Revenue, bookings, utilisation, staff performance. |
| **Marketing campaigns** | Discounts and cashback campaigns targeted at specific services, classes, or packages. |
| **Packages & memberships** | Sell a 10-session bundle; deduct sessions as they're used. |

Two audiences, therefore two apps, both talking to one API.

---

## 2. The Product Family — the three surfaces

```
                    ┌─────────────────────────────────────┐
                    │        bookit-api  (Node.js)        │
                    │  Express + Sequelize + PostgreSQL   │
                    │   29 modules · ~343 REST endpoints  │
                    │  Paymob · Kashier · Firebase · S3   │
                    │      Brevo (email) · WhatsApp       │
                    └───────▲──────────────────────▲──────┘
                            │                      │
              /business/*   │                      │  /client/*
                            │                      │
        ┌───────────────────┴───────┐   ┌──────────┴───────────────────┐
        │  B2B — bookit_mobile_app  │   │   B2C — bookit-b2c           │
        │  Flutter (iOS/Android/Web)│   │   Next.js 15 + React + PWA   │
        │  business.bookit-app.com  │   │   bookings.bookit-app.com    │
        │  + Google Play + App Store│   │   + Android TWA (APK/AAB)    │
        │                           │   │                              │
        │  THE BUSINESS OWNER       │   │   THE END CUSTOMER           │
        │  & THEIR STAFF            │   │   booking a massage          │
        └───────────────────────────┘   └──────────────────────────────┘

   Supporting repos in the same workspace:
   • bookit-website          — marketing site (www.bookit-app.com)
   • bookit-admin            — internal admin panel
   • bookit-whatsapp-webhook — WhatsApp message handling
   • lambda-notifier         — scheduled/async notification dispatch
   • bookit-offers           — offers/campaigns satellite
   • bookit-payment-tracker  — payment reconciliation tooling
```

### The one-sentence version of each

- **B2B** — *"I run a yoga studio. Show me today's schedule, let me add a client, take a payment, and tell me how much I made this month."*
- **B2C** — *"I want a 6pm yoga class on Thursday. Show me what's free, take my card, and email me a reminder."*
- **API** — *"I am the single source of truth for both of the above, and I must never let them disagree."*

> 🧠 **QA mindset:** Almost every serious Bookit bug is a **disagreement between two surfaces**. A slot the B2C page says is free but the B2B calendar says is booked. A payment the customer completed but the business never saw. **Always test a flow end-to-end across both apps, not in one app alone.**

---

## 3. Core Domain Concepts (learn these first)

You cannot test this platform without these. Learn them in this order.

### 3.1 Business → Location → Room/Station

- A **Business** is the tenant (e.g. "Zen Yoga Cairo").
- A Business has one or more **Locations** (branches). Nearly *everything* is scoped by `location_id`.
- A Location has **Business Hours** (per day) and optionally **Rooms / Stations** (treatment room 1, chair 3).

> ⚠️ **`location_id` is the #1 source of bugs.** Data leaking across locations, or a screen showing Location A's staff while Location B is selected, is a recurring class of defect. Always test with a business that has **at least two locations**.

### 3.2 Offerings — Appointments vs Classes

This is the single most important distinction in the product. **They are two different things with two different backend models.**

| | **Appointment** | **Class** |
|---|---|---|
| Nature | 1-to-1 booking with a practitioner | 1-to-many scheduled session |
| Example | 60-min deep tissue massage | 7pm Vinyasa Yoga, capacity 15 |
| Backend model | `Appointment` | `ClassBooking` + `Schedule` |
| Capacity | One slot, one client | Capacity-limited, many attendees |
| Time selection | Client picks a start time from availability | Client picks a pre-scheduled session |
| Category flag | `category.is_class = false` | `category.is_class = true` |
| Series booking | N/A | Yes — book a recurring enrollment |

> 🧪 **Test rule:** *Every* booking-related test case must be run **twice** — once for an appointment, once for a class. They are separate code paths in all three repos. A fix on one side very often does not apply to the other.

### 3.3 Services, Categories & Durations

- **Categories** are hierarchical (`level 0`, `level 1`…) — e.g. *Fitness → Yoga*.
- A **Service** (a.k.a. offering) belongs to a category and has one or more **Durations**, each with its own price (30 min / 60 min / 90 min).
- Services are assigned to **Staff Members** — only assigned staff appear as bookable for that service.

### 3.4 Staff

- A **Staff Profile** is linked to a **User** account and to one or more **Locations**.
- Each staff member has **Location Schedules** (per weekday, from/to times) and **Time Off** entries.
- `account_status` starts as `pending` — staff receive an invite, verify OTP, and set a password.
- `for_class` flags whether they teach classes.

**Availability = business hours ∩ staff schedule − time off − existing bookings − blocked slots.** If a slot appears that shouldn't (or vice versa), one of those five inputs is wrong. That's your debugging checklist.

### 3.5 Clients

- A **Client** is a customer of a business. A client can belong to multiple businesses.
- Clients can be created by the business (B2B "Add Client") or self-register via B2C.
- Clients have appointment history, packages, and (behind a flag) reviews.

### 3.6 Packages

- A **Package** is a bundle of sessions ("10 Pilates classes for X").
- When bought or assigned, the client gets a **ClientPackage** with a session balance and an expiry.
- Sessions are deducted on use — either automatically at booking, or via a **Session Deduction Approval** flow where staff request and the client approves.
- Statuses to know: package `draft | active | unavailable`; client package `pending | active | expired | completed | cancelled`; approval `pending | approved | rejected | expired | cancelled`.

### 3.7 Payments

- Two gateways behind an abstraction: **Paymob** and **Kashier** (`gateways/GatewayFactory.js`).
- Payment types: full payment, **deposit**, or pay-at-venue.
- **Payment Links** — the business generates a link and shares it (e.g. via WhatsApp); the customer pays at `bookings.bookit-app.com/pay/[token]`.
- **Refunds** and **cancellation policies** are policy-driven per business.
- Everything lands in `PaymentTransaction` with `booking_type` of `appointment | class_booking | package | cart`.

### 3.8 Subscriptions (Bookit's own billing)

Separate from customer payments — this is **what the business pays Bookit**. Statuses: `trialing | active | past_due | canceled | expired | exempt`. Write actions in the B2B app are gated on the subscription entitlement, so an expired subscription should degrade the app to read-only.

### 3.9 Notifications

Four channels: `email` (Brevo) · `whatsapp` · `sms` · `push` (Firebase). Templates are mapped per **event type × channel × language × target audience**. Delivery is logged in `NotificationLog` with statuses `pending → sent → delivered / failed / bounced / opened / clicked / skipped`.

---

## 4. The B2B App (Business / Merchant side)

**Repo:** `bookit_mobile_app` · **Stack:** Flutter (Dart 3.7.2+) · **Targets:** iOS, Android, Web
**Distribution:** Google Play, Apple App Store, and web at `business.bookit-app.com`
**Scale:** ~135 screens, ~323 presentation files, 23 feature modules.

### 4.1 Main navigation

The bottom nav is **capability-gated** — different users see a different number of tabs:

| Tab | Required capability | Notes |
|---|---|---|
| **Dashboard** | `dashboard.read` | Also gated on admin-level role identity, not capability alone |
| **Calendar** | `bookings.read` | The daily driver — full calendar with appointments + classes |
| **Analytics** | `reports.read` | Revenue, history, staff leaderboard |
| **Menu** | *(ungated)* | Settings hub — everything else lives here |
| **Profile** | *(ungated)* | Practitioner's own schedule; only shown if they have one |

> 🧪 **Test case:** log in as an owner and as a staff member and **count the tabs**. The index of the selected tab must match the page shown — there is explicit clamping logic in `home_screen.dart` guarding against exactly this class of bug.

### 4.2 Feature modules (`lib/features/`)

`auth` · `onboarding` · `dashboard` · `calendar` · `full_calender_feature` · `client_and_appointments` · `clients` · `staff_and_schedule` · `offerings` · `packages` · `rooms_and_stations` · `biling_and_payment` · `subscription` · `marketing_campaigns` · `qr_scanner` · `reviews` · `csv_import` · `csv_export` · `menu` · `map` · `landing` · `splash` · `main`

### 4.3 The flows you'll test most

**A. Signup → Onboarding (the first-run funnel)**
`/signup` → OTP verify → `/onboarding_welcome` → `/onboarding_about` → `/locations` (with map picker) → `/offerings` → `/add_services` → `/services_details` → `/onboard_finish_screen` → Dashboard.

This is a long, stateful, abandonable funnel. **Test interruption at every step** — kill the app, background it, lose network. The router (`lib/app/router.dart`) redirects based on `authProvider` state and onboarding completeness; a wrong redirect here locks a user out of the product entirely.

**B. Book an appointment for a walk-in**
Calendar → Book New Appointment → pick client (or add new) → pick service + duration → pick staff → pick slot → confirm → success screen.

**C. Class management**
Add/edit class + schedule → assign staff → view class attendees → add attendee manually → check in attendees.

**D. Payments & billing**
Billing & Payment → accept online payment setup → client payment methods → deposits & payments config → cancellation/refund policy → Transactions list → transaction detail → share payment link.

**E. QR check-in**
Scan → parse → check-in dialog → result. The scanner (`parse_scanned_code_use_case.dart`) recognises 5 payload kinds: `CheckIn:` prefixed codes, URLs, emails, phones, and plain text fallback.
> 🧪 **Test all five.** Also test: camera permission denied, a damaged/unreadable code, a valid code scanned twice, and a code for a booking at a *different* location.

**F. Packages**
Create package → assign to client → view holders → mark a session used (appointment or class path) → extend expiry → session approval accept/reject.

**G. CSV import/export**
Import hub → upload → column mapper → preview → result. **Deliberately feed it bad data**: wrong encoding, missing columns, duplicate rows, Arabic text, 10,000 rows, an empty file.

**H. Subscription**
Plans → checkout summary → checkout webview → payment confirmation → billing history → cancellation.
> ⚠️ The checkout is a **WebView**. Test back-button behaviour, session expiry mid-payment, and returning to the app after payment succeeds/fails/is-abandoned.

### 4.4 Localisation & RTL

English (`en`) and Arabic (`ar`, `ar_EG`). RTL is applied automatically by `LanguageService`.

> 🧪 **Every UI ticket should be verified in Arabic.** RTL bugs are extremely common: mirrored icons that shouldn't mirror, clipped text, misaligned calendars, back-buttons pointing the wrong way, and Latin/Arabic numeral mixing in dates and prices.

### 4.5 Feature flags

`lib/core/config/feature_flags.dart` — **compile-time** flags. Currently `enableReviews = false`, which hides the Reviews menu entry, review buttons, star ratings, and disables the review routes.

> 🧪 If you find review UI visible in a build, that's a bug. And if you're asked to test reviews, confirm the flag is on in *that* build first — otherwise you'll file a false "feature missing" report.

---

## 5. The B2C App (Customer side)

**Repo:** `bookit-b2c` · **Stack:** Next.js 15 (App Router) + React + Redux Toolkit + TypeScript + SCSS/Tailwind + Ant Design
**URL:** `bookings.bookit-app.com` · Also shipped as an **Android TWA** (APK/AAB via Bubblewrap)
**PWA:** Serwist service worker — installable, offline-capable, cached.

### 5.1 Route map (`app/[locale]/…`)

Every route is locale-prefixed (`/en/…` or `/ar/…`) — enforced by `middleware.ts` with `localePrefix: 'always'`.

| Route | Purpose |
|---|---|
| `/` | Landing |
| `/marketplace` | Browse businesses |
| `/business/[businessSlug]` | Business page |
| `/business/[businessSlug]/[locationSlug]` | Location-specific booking page ← **the core funnel** |
| `/booking/listing` | Booking listing |
| `/auth/login`, `/auth/register`, `/auth/social-login` | Auth |
| `/home` | Signed-in customer dashboard |
| `/home/bookings/[[...id]]` | My bookings |
| `/home/fitnessclasses` | My classes |
| `/home/packages/[[...id]]` | My packages |
| `/home/cancelations` | Cancellations |
| `/home/session-approvals` | Approve staff-requested session deductions |
| `/home/profile`, `/home/settings` | Profile & settings |
| `/pay/[token]` | **Payment link** landing page |
| `/payment/result` | Gateway return / result page |

### 5.2 The three booking flows

Three distinct components, three distinct code paths — **test all three**:
- `ServiceBookingFlow.tsx` — appointments
- `ClassBookingFlow.tsx` — classes
- `PackageBookingFlow.tsx` — packages

Supporting pieces you'll poke at: `BookingCalendar`, `TimeSlotGrid`, `TimeSlot`, `BookingCart`, `ConfirmBooking`, `BookByPractitioner`, `CancellationPolicySection`, `UpsellPackageSection`, `BookingUnavailableBanner`, `RescheduleBanner`.

### 5.3 Auth

NextAuth with JWT session cookies, plus social login (Google / Apple / Facebook). `middleware.ts` reads the JWT `exp` claim at the edge (without verifying — verification is the API's job) to decide whether to admit a request to a protected page.

> ⚠️ **Known-sensitive area.** The repo contains a large trail of fix docs — `FIX_LOGIN_RACE_CONDITION.md`, `MOBILE_LOGOUT_LOOP_FIX.md`, `WHITE_SCREEN_FIX_V2.md`, `VERCEL_WHITE_SCREEN_FIX.md`, `MOBILE_REDIRECT_FIX.md`. Translation: **login, logout, redirect loops, and white screens have all bitten before.** Regression-test them every release, and specifically on real mobile browsers and inside the TWA.

### 5.4 PWA specifics

- Service worker caching means **users can be served stale JS after a deploy**. Test a hard reload and an app-restart after every release.
- Test the **installed TWA/PWA** separately from the browser — navigation, back button, and auth cookies all behave differently.
- Offline: what happens mid-booking with no network?

---

## 6. The API (the shared brain)

**Repo:** `bookit-api` · **Stack:** Node.js + Express + Sequelize + PostgreSQL, Dockerised, Swagger-documented.

### 6.1 Structure

```
bookit-api/
├── modules/          # 29 domain modules — the real code lives here
│   └── <domain>/
│       ├── controllers/   ├── manager/     ├── services/
│       ├── models/        ├── migrations/  ├── routes/
│       ├── validations/   ├── seeders/     └── utils/
├── routes/           # Audience-scoped route mounting: admin / business / client
├── gateways/         # PaymobGateway, KashierGateway, GatewayFactory
├── middlewares/      # auth, validation, model loading
├── locales/          # API-side i18n
└── docs/             # Swagger
```

**Modules:** `admin-analytics` · `appointments` · `auth` · `bookings` · `businesses` · `categories` · `countries` · `dashboard` · `import` · `jobs` · `locations` · `marketing` · `notifications` · `odoo` · `packages` · `payments` · `permission` · `photogallary` · `policies` · `profile` · `reviews` · `role` · `schedules` · `services` · `staffavailabilities` · `subscriptions` · `translations` · `whitelabel`

### 6.2 Standard response envelope

Every response looks like this — learn it, because it's what you'll paste into bug reports:

```json
{
  "statusCode": 200,
  "status": true,
  "message": "Staff members retrieved successfully",
  "data": { "result": [ ] },
  "token": null,
  "requestId": "750733fb-b800-43f4-985b-eb223012d396"
}
```

> 🔑 **`requestId` is your best friend.** Always capture it. It lets the backend team find your exact request in the logs. **A bug report with a `requestId` gets fixed in a fraction of the time.**

### 6.3 Key endpoint families

Base: `https://api-dev.bookit-app.com/api/v1`

| Area | Representative endpoints |
|---|---|
| **Auth** | `POST /login` `/register` `/business-register` `/social-login` `/verify-otp` `/resend-otp` `/refresh-token` `/initiate-password-reset` `/reset-password` · `GET /me/roles` |
| **Appointments** | `GET /availability` `/bookedslots` `/location/:id` · `PATCH /:id/accept` `/decline` `/arrived` `/check-in` · `POST /reschedule/:id` · `PUT /cancel/:id` |
| **Bookings (classes)** | `POST /` `/series` `/:id/reschedule` · `PATCH /:id/cancel` `/:id/check-in` `/:id/no-show` · `GET /cancellations` · `PATCH /cancellations/:id/refund` |
| **Payments** | `GET/POST /transactions` · `GET /methods` · `GET /transactions/booking/:type/:id` |
| **Packages** | `POST /:packageId/assign` `/client-packages/:id/use-session` `/add-session` · `PATCH /:approvalId/approve` `/reject` `/extend-expiry` |
| **Marketing** | `POST /campaigns` `/campaigns/:id/publish` `/pause` `/resume` `/end` `/duplicate` · `POST /promo/validate` `/pricing/preview` · `GET /campaigns/:id/metrics` |
| **Schedules** | `GET /:id/available-sessions` `/business/:id/day/:day/:date` · `POST /validate-batch-conflicts` `/refund` · `PATCH /:id/cancel` `/restore` |
| **Subscriptions** | `POST /checkout` `/cancel` `/resume` · `POST /webhook/paymob` `/webhook/kashier` · `POST /businesses/:id/exempt` `/extend-trial` |
| **Profile** | `GET /staff/location/:id` `/staff/categories` `/client/:id/appointment-history` `/staff/:id/time-off` |
| **Notifications** | `GET /` `/unread-count` · `PATCH /mark-all-read` · `POST /register` (device token) `/morning-digest` |

### 6.4 Integrations to be aware of

**Paymob** & **Kashier** (payments) · **Firebase** (push + auth) · **Brevo** (transactional email) · **WhatsApp** (via `bookit-whatsapp-webhook`) · **AWS S3** (media; note the bucket differs per environment) · **Mapbox** (location picker) · **Odoo** (ERP sync — appointments, clients, payments, staff, services carry `odoo_sync_status: pending | synced | error`).

---

## 7. Environments, URLs & Builds

| | **Dev** | **Production** |
|---|---|---|
| **API** | `api-dev.bookit-app.com/api/v1` | `api.bookit-app.com/api/v1` |
| **B2B** | `business-dev.bookit-app.com` | `business.bookit-app.com` |
| **B2C** | `bookit-b2c-dev.vercel.app` | `bookings.bookit-app.com` |
| **App name** | "Bookit Dev" | "Bookit" |
| **S3 bucket** | `bookit-api-media-dev` | `bookit-api-media` |

- Marketing site: **`www.bookit-app.com`**
- The B2B environment is set by `Flavor` in `bookit_mobile_app/lib/app/config.dart`. **Check which flavor a build is on before you file anything** — "the app shows no data" is usually "the build points at an environment with no seed data."
- **There are only two environments** — Dev and Production. The Flutter `Flavor` enum also declares a `staging` value, but no staging environment is deployed; ignore it.

---

## 8. Roles, Capabilities & Permissions

Bookit separates **identity** (roles) from **authority** (capabilities). The **server is the source of truth**; the client only names what arrives.

### Roles
- **Elevated:** `admin`, `owner`, `super_admin` (also `superadmin`) — full access.
- **Restricted:** `staff_member`, empty roles, or anything unrecognised — read-mostly, own-schedule access.
- API-level base roles seeded: `superadmin`, `admin`, `user`.

### Capabilities (`lib/core/access/capability.dart`, mirroring `config/rolePermissions.js`)

```
business.read/write · staff.read/write/delete · clients.read/write/delete
packages.read/write/fulfil · offerings.read/write · bookings.read/write
checkout.read/write/refund · settings.read/write · marketing.read/write
reviews.read · dashboard.read · reports.read · financials.read/write
membership.read/write · data.import · data.export · schedule.own.read · checkin.write
```

Three rules that matter for testing:

1. **Write capabilities are additionally gated on the subscription entitlement.** Reads are not. An expired/past-due subscription should make the app read-only — **not** crash, and **not** silently fail a save.
2. **Unknown capabilities from a newer server must not crash the app** (`Capability.fromWire` returns `null` and is skipped). If the API adds a capability and an older app build crashes, that's a P1.
3. **Fallback behaviour:** if the server sends no capability list (old API, offline cold start), the app falls back to a deliberately **read-only floor** for the role. Safe direction — verify it stays that way.

> 🧪 **Permission testing is a first-class QA activity here, not an afterthought.** For every new screen ask: *what does a `staff_member` see? What does an owner on an expired subscription see?* There is a `roles_permissions_dev_screen.dart` in the app to help you inspect this.

---

## 9. State Machines — the statuses you must memorise

Print these. You'll reference them constantly.

**Appointment.status**
`pending · confirmed · cancelled · completed · booked · rescheduled · no_show · deposit_paid · payment_processing · paid · payment_failed · abandoned · requested`

**Appointment.payment_status**
`pending · completed · failed · refunded · abandoned`

**ClassBooking.status**
`pending · confirmed · cancelled · completed · no_show · deposit_paid · payment_processing · paid · payment_failed · rescheduled · abandoned`

**ClassBooking.payment_status**
`pending · paid · failed · refunded · package · series · abandoned`

**PaymentTransaction.status**
`pending · processing · completed · failed · refunded · partially_refunded · abandoned`
*(with `booking_type`: `appointment · class_booking · package · cart`)*

**BookingCart.status** — `pending · paid · confirmed · free_confirmed · failed · cancelled`

**Package.status** — `draft · active · unavailable`
**ClientPackage.status** — `pending · active · expired · completed · cancelled` (source: `purchase | admin_assigned`)
**SessionDeductionApproval.status** — `pending · approved · rejected · expired · cancelled`

**MarketingCampaign** — type `DISCOUNT | CASHBACK`, value `PERCENTAGE | FIXED`, status `draft · scheduled · active · paused · ended`, targets `service | class | package`
**WalletLedger** — `credit | debit`, status `active · consumed · expired · reversed`

**BusinessSubscription.status** — `trialing · active · past_due · canceled · expired · exempt`
**SubscriptionPayment.status** — `pending · paid · failed · expired · refunded`

**NotificationLog** — channel `email | whatsapp | sms | push`; status `pending · sent · delivered · failed · bounced · opened · clicked · skipped`

**Odoo sync (on appointments, payments, staff, clients)** — `pending · synced · error`

> 🧪 **The `abandoned` status is a recent addition across appointments, class bookings and payment transactions.** It represents a user who started paying and walked away. This is fertile bug ground: verify abandoned bookings **do not** hold a slot hostage, **do not** appear on the business calendar as confirmed, and **can** be re-attempted by the customer.

---

## 10. High-Risk Areas — where the bugs live

Ranked by likelihood × impact, based on the code's own history.

### 🔴 P0 — Break these and money or trust is lost

1. **Payments & webhooks.** Two gateways, deposits, refunds, partial refunds, payment links, and gateway webhooks. Test: successful payment, declined card, user closes the browser mid-payment, duplicate webhook delivery, refund of a partially-refunded transaction. Cross-check the transaction in the B2B Transactions screen every time.
2. **Double-booking / availability.** Two customers booking the same slot simultaneously. A class at capacity. A staff member booked at two locations at once. `POST /validate-batch-conflicts` exists for a reason.
3. **Auth & session.** Login race conditions, logout loops, token refresh, social login, OTP delivery and expiry, staff invite → OTP → set password. Redirect-loop and white-screen regressions in B2C.
4. **Timezone & DST.** Appointments have `start_from`, `end_at`, `date`; there is an explicit *"harden schedule and timezone columns"* migration. Test a booking made in one timezone and viewed in another, and dates near midnight.

### 🟠 P1 — Break these and the product looks broken

5. **Multi-location data scoping.** Always test with ≥2 locations.
6. **Capability/permission gating.** Staff seeing owner data; owner on expired subscription able to write.
7. **Calendar rendering.** Day/week/month views, overlapping appointments, all-day items, classes vs appointments in the same grid, grouped clients.
8. **RTL / Arabic.** Every screen, every release.
9. **Packages session accounting.** Sessions deducted twice, or not at all, on cancellation/reschedule/no-show. Expiry edge cases.
10. **PWA cache staleness** after a B2C deploy.

### 🟡 P2 — Quality and polish

11. CSV import with malformed data.
12. Notification delivery across 4 channels × 2 languages.
13. Marketing campaign pricing preview vs actual charged amount.
14. Media/S3 URLs across environments (`fixS3ImageUrl` rewrites bucket names — verify images actually load).
15. Odoo sync error states surfacing sensibly.

---

## 11. Your First Week — a concrete plan

### Day 1 — Orientation
- Read this document. Then read the three `CLAUDE.md` files (repo root, `bookit_mobile_app/`, `bookit-api/`).
- Get accounts: **Dev** environment, a business owner login, a staff-member login, and a customer login.
- Install the B2B app (dev build) on a **real iOS device and a real Android device**. Open the B2C dev URL on both.
- Bookmark the API Swagger docs and install Postman or similar.

### Day 2 — Walk the happy paths, take notes, don't file anything yet
- **B2B:** sign up a brand-new business and complete onboarding end to end. Note every point of confusion.
- **B2B:** create a location, a room, a service with two durations, a class with a schedule, and a staff member.
- **B2C:** find that same business, and book one appointment and one class.
- **B2B:** confirm both bookings appear on the calendar with correct times.

### Day 3 — Money
- Configure online payments. Take a test card payment for an appointment.
- Generate a payment link, open it on a phone, pay it.
- Issue a refund. Verify the transaction status and the customer's view.
- Test a **declined** card and an **abandoned** payment.

### Day 4 — Permissions, languages, devices
- Repeat the Day 2 flows as a `staff_member`. Document every difference.
- Switch both apps to **Arabic**. Screenshot anything that looks wrong.
- Test on a small phone, a large phone, a tablet, and B2B on web.

### Day 5 — Build your toolkit
- Write your first **regression checklist** from what you learned (start from §12).
- Set up a bug-report template (§13).
- Ask the team: *Which areas broke most recently? What's shipping next sprint?* Aim your exploratory testing there.

---

## 12. Smoke Test Suite (run this before every release)

A pass here means "safe to ship." It should take under 60 minutes.

**Auth (both apps)**
- [ ] B2B login / logout / re-login
- [ ] B2C login / logout / re-login (browser **and** installed PWA)
- [ ] Social login (Google, Apple, Facebook)
- [ ] Forgot password → OTP → reset → login with new password
- [ ] Session persists across app restart; expired token refreshes cleanly

**Core booking — appointment**
- [ ] B2C: browse business → pick service → pick staff → pick slot → confirm
- [ ] B2B: appointment appears on calendar at the correct time & location
- [ ] B2B: reschedule it → B2C reflects the change
- [ ] B2B: cancel it → slot is released → B2C reflects the change

**Core booking — class**
- [ ] B2C: book a class session
- [ ] B2B: attendee appears in Class Attendees
- [ ] Capacity limit is enforced (book until full, then try one more)
- [ ] B2B: add an attendee manually
- [ ] Check in an attendee

**Payments**
- [ ] Successful card payment → transaction appears in B2B with status `completed`
- [ ] Declined card → booking is not confirmed, slot not held
- [ ] Deposit-only payment records the correct amount
- [ ] Payment link opens, pays, and updates the booking
- [ ] Refund processes and shows correct status

**Packages**
- [ ] Assign a package to a client
- [ ] Use a session → balance decrements by exactly 1
- [ ] Cancel a package-paid booking → session is returned

**QR check-in**
- [ ] Scan a valid `CheckIn:` code → client marked checked in
- [ ] Scan an invalid code → graceful error, no crash
- [ ] Camera permission denied → clear guidance shown

**Permissions**
- [ ] Staff member sees the correct number of nav tabs, and no owner-only screens
- [ ] Owner sees everything

**Localisation**
- [ ] Switch to Arabic in both apps; navigate the main flows; layout is RTL and unbroken

**Platform**
- [ ] B2B iOS · B2B Android · B2B web
- [ ] B2C mobile browser · B2C desktop browser · B2C installed PWA/TWA
- [ ] After a B2C deploy: hard reload serves the new build

**Notifications**
- [ ] Booking confirmation arrives (email + push)
- [ ] Push notification opens the correct screen

---

## 13. How to Write a Bookit Bug Report

Because this is a three-repo platform, a Bookit bug report needs more than "it's broken."

```markdown
**Title:** [B2B/B2C/API] Short, specific summary

**Environment:** Dev / Prod
**App & version:** B2B Flutter v1.0.84+167 (Android 14, Pixel 7) | B2C (Chrome 130, iPhone 15 PWA)
**Account:** owner@... (role: owner) / business: "Zen Yoga" / location: "Maadi"
**Language:** English / Arabic

**Steps to reproduce:**
1.
2.
3.

**Expected:**
**Actual:**

**Evidence:**
- Screenshot / screen recording
- API requestId: `750733fb-...`   <- ALWAYS include if any request was involved
- Relevant IDs: business_id, location_id, appointment_id, transaction_id
- Console / device log excerpt

**Cross-surface check:**   <- the Bookit-specific bit
- Does the other app agree? (e.g. "B2C shows the slot free, B2B shows it booked")
- Does the API agree? (paste the relevant endpoint response)

**Reproducibility:** Always / Intermittent (x of y attempts)
**Severity:** P0 blocker / P1 major / P2 minor / P3 cosmetic
```

**Three habits that will make you excellent here:**

1. **Always capture the `requestId`.** It's in every API response.
2. **Always check the other surface.** Half of Bookit's bugs are consistency bugs; knowing *which* side is wrong halves the fix time.
3. **Always state the environment and flavor.** "No data showing" is very often "dev build, empty dev DB."

---

## 14. Tooling, Test Suites & Useful Commands

### B2B — `bookit_mobile_app` (Flutter)
```bash
flutter pub get                     # install deps
flutter run                         # run on connected device
flutter test                        # run the test suite (~178 test files)
flutter test test/unit/app/main_test.dart
flutter analyze                     # static analysis — must be clean
dart format lib/
flutter build apk --release         # Android build
cd ios && pod install && cd .. && flutter build ipa --release
flutter clean && flutter pub get    # when things get weird
```
Test layout: `test/unit/`, `test/widget/`, plus feature test documentation markdown files in `test/`.

### B2C — `bookit-b2c` (Next.js)
```bash
npm run dev            # local dev server
npm run build          # production build
npm test               # Jest
npm run type-check     # tsc --noEmit
npm run lint:all       # eslint + stylelint + prettier check
npm run build:apk      # Bubblewrap TWA Android build
```

### API — `bookit-api` (Node)
```bash
npm install
npm test                        # Jest
# jest.realdb.config.js exists for tests against a real database
docker-compose -f docker-compose.dev.yml up
```
Swagger docs live in `docs/`; there is an extensive audit trail in the repo root (`SWAGGER_*.md`, `ENDPOINT_*.md`, `PAYMENT_*.md`) — useful reference, but **treat the source as truth over the markdown**, as some of those docs describe completed migrations rather than current state.

### Recommended additions to your kit
- **Postman/Insomnia** with a Bookit collection (there's a Paymob Postman collection in `bookit-api/Paymob API-Postman-Collections-main`).
- **Charles Proxy / Proxyman** for inspecting mobile app traffic — invaluable for cross-surface debugging.
- **Real devices**, at minimum one iOS and one Android. Simulators hide push-notification, camera/QR, and deep-link bugs.

---

## 15. Glossary

| Term | Meaning |
|---|---|
| **B2B** | The business-facing app (Flutter) — `business.bookit-app.com` + app stores |
| **B2C** | The customer-facing app (Next.js PWA) — `bookings.bookit-app.com` |
| **Business** | A tenant on the platform (a studio, salon, gym, clinic) |
| **Location** | A branch of a business; scopes almost all data |
| **Offering** | A bookable thing — either a service (appointment) or a class |
| **Service** | A 1-to-1 bookable treatment with durations and prices |
| **Class** | A scheduled group session with a capacity |
| **Schedule** | The recurring time definition for a class |
| **Duration** | A priced length variant of a service (30/60/90 min) |
| **Staff Profile** | A practitioner/instructor, linked to a user and location(s) |
| **Client** | A customer of a business |
| **Package** | A pre-paid bundle of sessions |
| **ClientPackage** | A specific client's instance of a package, with a session balance |
| **Session Deduction Approval** | Staff-requested, client-approved use of a package session |
| **Payment Link** | A shareable URL (`/pay/[token]`) for taking payment out-of-band |
| **Deposit** | Partial upfront payment to secure a booking |
| **Entitlement** | Whether a business's Bookit subscription permits write actions |
| **Capability** | A granular permission string (e.g. `bookings.write`) sent by the server |
| **Flavor** | The build environment for the Flutter app — in practice `dev` or `prod` |
| **TWA** | Trusted Web Activity — the Android wrapper shipping B2C as an APK |
| **requestId** | UUID in every API response; use it to trace requests in logs |
| **Odoo sync** | Optional ERP integration mirroring bookings/payments outward |
| **White-label** | Serving a business under its own branding/domain |

---

## Where to go next

1. Read `bookit_mobile_app/lib/app/router.dart` — the full B2B screen map in one file.
2. Read `bookit_mobile_app/lib/core/access/capability.dart` — the permission vocabulary.
3. Skim `bookit-api/modules/appointments/` and `bookit-api/modules/bookings/` side by side — this is the appointment-vs-class split that shapes the whole product.
4. Open `bookit-b2c/components/business/` — the B2C booking funnel in component form.

**Welcome to the team. Break things carefully. 🧪**

---

*Document generated from a source-code deep dive across `bookit_mobile_app`, `bookit-b2c`, and `bookit-api`. If something here contradicts the code, the code is right — please update this document.*
