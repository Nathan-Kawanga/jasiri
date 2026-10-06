# Jasiri handoff (for the next Claude session)

Read this, then `CLAUDE.md` and `README.md`, before changing anything.

## Who and what
- Owner: Nathan Kawanga. Wants a ruthless business mentor: stress-test ideas, push back
  when something is wrong, keep everything launchable and cheap to run.
- Product: Jasiri, a web app (PWA) for Kenyan barbershops. Barbers, service staff
  (head wash, massage, facial) and cashiers work on commission; counts get changed.
  A single-use code per client fixes who did the work. Barbers own a client book and a
  public booking link that move with them between shops.
- The app never handles money or records how a client paid.

## Where things live
- Code: GitHub `nathan-kawanga/jasiri`, branch `main`. Vercel deploys `main` automatically.
- Live app: https://jasiri-blond.vercel.app
- Database: Nathan's hosted Supabase project. Schema changes are NOT applied automatically:
  every change goes in `supabase/migrations/` AND as a paste-able `supabase/update-N-*.sql`
  that Nathan runs in Supabase → SQL Editor. Write updates so they are safe to re-run
  (if not exists, create or replace, drop ... if exists). Update 6 failed once because it
  wasn't, and the app hid the error; don't repeat that.
- Make the app degrade gracefully if it deploys before Nathan runs the SQL.

## Hosted database status (as of the end of the cloud session)
Applied: setup-all (initial), update 2 (photos), update 4 (lookup limits), update 8
(repair = updates 5, 6, 7). **Confirm with Nathan that he ran update 9 (services and
prices), update 10 (barber-first: a barber who adds a shop stays a barber) and update 11
(payout sheet per code).**

## Decisions made with Nathan (don't undo without asking)
- No price list or commission shares. Staff type what they charged; cashier types what
  was actually paid; differences are flagged. Each person may keep an optional menu of
  services and prices (update 9) used for booking and tap-to-fill; amounts stay editable.
- No SMS at all (cost). PIN resets go through the platform admin. Phone + 6-digit PIN login;
  shared cashier accounts use an email.
- Code states: created → open → paid, plus voided / cancelled. On client confirm, the code
  shows on the service staff queue AND the cashier screen at the same time.
- Barbers drive adoption, not owners. Anyone signs up, picks a role, finds the shop by
  name (typo-tolerant) or adds it. New staff need 2 coworkers to vouch (1 while the shop has
  one person); 2 "No"s reject. Owner/manager requests are approved by the shop's manager only.
  Whoever adds a shop becomes its manager and can hand the role over. A barber who adds a
  shop is manager AND barber: home shows the barber view; manager tools sit behind one
  "Shop admin" tile (`/shop/admin`). Manager-only accounts land on Shop admin.
- Same client with another barber in the same shop: look up by exact phone number only;
  first name returned; 1 successful find per hour and 10 per day per barber; misses don't
  count (60/day cap); over the limit answers like "not found".
- Barbers pay: 30 days free, then a pay prompt; admin records payment by hand. Staff free.
- Kill criteria: ≥60% of barbers with 15+ codes in the last 7 days (week 4), ≥40% of barbers
  paying after the free month. Shown on the admin page.
- Landing page for signed-out visitors; Sign in top right; contact details are placeholders
  in `src/lib/site.ts`; stats are true product facts, never invented traction.
- Look: dark, single gold accent. Don't add more colours.
- Payout sheet: one row per paid code, barber side then service staff side (Nathan's layout),
  with "Totals per person" underneath. Exports keep the barber amount on a code's first row
  only so columns add up. Falls back to rebuilding codes from payout_sheet before update 11.
- Marketplace (find barbers near you) is a later phase; current design was kept compatible.

## Pilot
- Pilot shop: "Wababaz barbershop & Spa", Ruai (Kangundo Road). Joseph (barber) created it
  and is its manager. Faith and Kawanga are joining as staff for the first code tests.
- Nathan's own test shop "Wababaz" (Ruai) can be removed after the pilot.

## Open items / ideas not built
- Merge or remove duplicate shops from the admin screen (only if duplicates show up).
- Admin fallback to approve stuck join requests (only if requests sit unanswered).
- Service staff booking links (only if clients ask).
- Real contact details on the landing page before sharing it publicly.
- HostPinnacle SMS, Swahili strings, ODPC registration and Vercel Pro before charging.

## How to work locally
See README "Run it locally". Tests: `npm test` (needs local Supabase via Docker),
`node tests/e2e-smoke.mjs` and `node tests/e2e-flow.mjs` against a running build.
