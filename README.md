# Jasiri

Barber code chain, client book and booking link. A web app (installable on Android home
screens) for Kenyan barbershops where barbers and service staff work on commission.

Every client gets a short code from the barber who served him. The same code goes with him to
the service staff and then to the cashier. Who did the work is fixed when the code is made, and
nobody can move it later. Barbers keep their own client book and public booking link, and both
follow them if they change shops.

The app never handles money and never records how a client paid.

## What's in this version

| Area | What works |
|---|---|
| Accounts | Sign up with name + phone (or email for a shared cashier account) + 6-digit PIN. No SMS. 5 wrong PINs lock the account for 15 minutes. 30-day sessions. Changing your PIN signs out your other phones. The platform admin resets forgotten PINs. |
| Shops | Create a shop (you become shop manager) or join with a 6-letter code or invite link. Join requests give no access until approved with roles. Roles: shop manager, barber, service staff, cashier (one person can hold several). |
| Code chain | Barber makes a code (returning client, new client with consent tick, no details, or from a booking) and types what he charged. Client taps **Confirm my code**. The code then shows on the service queue **and** the cashier screen at the same time. Service staff are assigned automatically (on duty today, fewest open codes, longest wait). Service staff confirm the client, type what they charged, hand over or mark No service. Service-only codes for clients with no haircut. Cashier types the amount actually paid and the client taps to confirm: that is "paid". Voids need a reason. Live updates with a 10-second fallback. |
| Proof labels | Each code is **Cashier-confirmed** (paid), **Self-recorded** (still open) or **Voided**. Staff download their record as Excel, PDF or CSV. |
| Client book | Belongs to the barber. Verified visits (paid codes), last visit, usual gap, total, "due for a cut" first. Search by name or last digits. CSV export. |
| Booking link | `/b/{handle}`, no login. Weekly bookable times plus off days and busy blocks, 30-minute default slots, 7 days ahead. One booking per slot, enforced by the database. One active future booking per number per barber. Confirmation shows a masked number, never a stored name. Cancel link. Barber's day view with Start code, no-show, manual bookings. Share tools: copy link, WhatsApp quick reply, printable QR code. |
| Money views | Staff earnings (today, week, month), cashier payout sheet (print, Excel, PDF, CSV), daily summary (what the till should hold). |
| Flags | Confirmed but unpaid after the day ended; paid amount different from staff totals; voids per person; handovers; voided and remade under a different barber within 10 minutes; open problem reports. |
| Admin | All accounts and shops, suspend, mark barbers paid until a date, payment instructions and price, any shop's audit log, delete a client record on request, PIN reset, platform usage and the kill criteria. |
| Photos | Barbers add a profile photo and up to 12 photos of their cuts (shrunk on the phone to ~100 KB). They show on the booking page as a cover, avatar and "My work" gallery. |
| Audit | Every change is written to an append-only log (who, which roles, what, when, before, after). Phone numbers never enter it. |

### Changed from the original spec (agreed in planning)

- **No price list or commission shares.** Barbers and service staff type what they charged; the cashier types what was actually paid. A difference is flagged. Shops settle splits themselves.
- **No SMS.** Sign-up has no SMS check; PIN resets go through the platform admin. HostPinnacle and booking reminders are not built.
- **No owner role or owner view** for now. Barbers are the paying users (30 days free, then a pay prompt; the admin records payment by hand).
- **Codes open at the service staff and the cashier at the same time** once the client confirms, so a client who skips the wash can pay and leave.
- **States:** `created → open → paid`, plus `voided` and `cancelled` (barber cancels before confirm). "Open" replaces the original `confirmed / with_service_staff / ready_for_payment` steps; service progress is a separate field.
- **Flags dropped:** wash attachment, old-book comparison, price-change notices.

## Run it locally

Needs Node 22+ and Docker.

```bash
npm install
npx supabase start            # local Postgres, auth, realtime (Docker)
npx supabase status -o env    # copy API_URL, ANON_KEY, SERVICE_ROLE_KEY into .env.local (see .env.example)
npm run db:reset              # apply the schema
npm run seed                  # demo shop, staff and two weeks of codes
npm run dev                   # http://localhost:3000
```

If Docker can't pull images from `public.ecr.aws`, prefix the Supabase commands with
`SUPABASE_INTERNAL_IMAGE_REGISTRY=docker.io`.

### Demo accounts (after `npm run seed`)

| Who | Sign in | PIN |
|---|---|---|
| Platform admin | 0700000001 | 111111 |
| Juma (shop manager + barber) | 0711000001 | 123456 |
| Brian (barber, booking link `/b/brian`) | 0711000002 | 123456 |
| Kevin (barber) | 0711000003 | 123456 |
| Mary (service staff) | 0722000001 | 123456 |
| Grace (service staff + cashier) | 0722000002 | 123456 |
| Shop cashier account | cashier@kinyozibora.test | 222222 |

Shop join code: `KB2345`.

## Tests

```bash
npm test                                   # 25 database + API tests against local Supabase
npm run build && npm start                 # then, in another shell:
node tests/e2e-smoke.mjs                   # every screen, every role, at 360px
node tests/e2e-flow.mjs                    # barber → service → cashier live, plus a public booking
```

Set `CHROMIUM_PATH` if Playwright's bundled browser isn't installed.

The spec's 15 required tests map to `tests/*.test.ts` by number. Test 10 checks the flags that
remain (the wash-attachment flag was dropped). Test 14 checks the per-number and per-IP limits
and the PIN lockout, since SMS was dropped.

## How it's built

- **Next.js 16** (App Router, TypeScript, Tailwind 4). Mobile first: 360px, 48px+ tap targets,
  system fonts, about 140 KB of compressed JavaScript on a staff screen.
- **Supabase**: Postgres with Row Level Security on every table, Auth (phone or email + PIN), Realtime.
- **All business rules live in the database** (`supabase/migrations`), as security-definer
  functions plus triggers and constraints. The web UI only calls those functions, so an Android
  app can reuse them unchanged. Every write takes a request id, so a double tap or a retry never acts twice.
- Rules that hold even for the database superuser: the barber, shop and display code on a code
  never change; paid, voided and cancelled codes are final; codes are never deleted; amounts lock
  once the client confirms; the audit log can't be updated, deleted or truncated.
- All UI words are in `src/lib/strings.ts` (Swahili can be added later). Role guides are in the app at `/guide`.

## Deploying (when ready)

1. Create a Supabase project. Run `npx supabase link`, then `npx supabase db push`.
   In Auth settings, turn off public sign-ups (the server creates accounts) and email confirmations.
2. Create a Vercel project from this repo. Set `NEXT_PUBLIC_SUPABASE_URL`,
   `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` and `NEXT_PUBLIC_SITE_URL`.
3. Database updates after the first setup are in `supabase/update-*.sql`; run each once in the SQL Editor, in order.
4. Make yourself platform admin:
   `update public.profiles set is_platform_admin = true where phone = '+2547XXXXXXXX';`

Vercel's free Hobby plan does not allow commercial use, so move to Pro once shops pay. Storing
client phone numbers means registering with the Office of the Data Protection Commissioner.

## Known limits

- No offline mode: the app shows a "No connection" banner and retries the current action.
- The client's "tap" is a habit, not proof of identity: anyone holding the phone can tap.
  The real protections are the fixed barber on each code, the cashier-confirmed amount and the flags.
- The booking page tells a visitor whether a number is already in that barber's book (to skip the
  name step). It never reveals a name, and it is rate-limited.
- No photo on the booking page yet.
