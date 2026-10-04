@AGENTS.md

# Jasiri: notes for code changes

- **Start by reading `docs/HANDOFF.md`**: decisions made with Nathan, live database status, pilot, open items.

- Business rules belong in Postgres (`supabase/migrations`), not in React. Writes go through
  `public.*` security-definer functions that take `p_request uuid` (idempotency) and raise short
  error codes (`not_allowed`, `code_is_final`, …) mapped to words in `src/lib/strings.ts`.
- Signed-in users have SELECT only (RLS). `anon` can call nothing. Public booking, rate limits and
  login checks are service-key only and are called from server actions in `src/app/b/actions.ts`
  and `src/app/auth-actions.ts`.
- Never expose client phone numbers outside the owning barber (`clients` RLS, `my_client_book`,
  `my_day`). Codes carry only `client_first_name`. The audit trigger strips `phone` and `cancel_token`.
- Days are Nairobi calendar days (`private.today()`, `private.nairobi_date()`).
- Every UI string goes in `src/lib/strings.ts`.
- Client-side writes use `act()` / `useAct()` from `src/lib/action.ts` (request id reuse + retry).
- Tests: `npm test` (needs local Supabase + `.env.local`), browser checks in `tests/e2e-*.mjs`.
- Next.js 16: `proxy.ts` (not middleware), async `params`/`searchParams`, run `npx next typegen`
  before `tsc`.
