// Demo data for local testing: one shop, staff in every role, two weeks of codes,
// bookings, and a few deliberate problems so the flags have something to show.
// Run after `npm run db:reset`:  npm run seed
import { createClient } from "@supabase/supabase-js";
import pg from "pg";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const dbUrl = process.env.SUPABASE_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
if (!url || !serviceKey) throw new Error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (see .env.example)");

const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
const db = new pg.Client({ connectionString: dbUrl });

let seed = 42;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = <T,>(a: T[]) => a[Math.floor(rand() * a.length)];
const ALPHA = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const used = new Set<string>();
function displayCode() {
  for (;;) {
    const c = Array.from({ length: 4 }, () => ALPHA[Math.floor(rand() * ALPHA.length)]).join("");
    if (!used.has(c)) { used.add(c); return c; }
  }
}

type Person = { key: string; name: string; phone?: string; email?: string; pin: string; barber?: string; role?: string };
const PEOPLE: Person[] = [
  { key: "admin", name: "Jasiri Admin", phone: "+254700000001", pin: "111111" },
  { key: "juma", name: "Juma Otieno", phone: "+254711000001", pin: "123456", barber: "juma", role: "manager" },
  { key: "brian", name: "Brian Kamau", phone: "+254711000002", pin: "123456", barber: "brian" },
  { key: "kevin", name: "Kevin Mwangi", phone: "+254711000003", pin: "123456", barber: "kevo" },
  { key: "mary", name: "Mary Wanjiru", phone: "+254722000001", pin: "123456", role: "service_staff" },
  { key: "grace", name: "Grace Achieng", phone: "+254722000002", pin: "123456", role: "service_staff" },
  { key: "cashier", name: "Cashier Kinyozi Bora", email: "cashier@kinyozibora.test", pin: "222222", role: "cashier" },
];

async function createUser(p: Person): Promise<string> {
  const loginEmail = p.phone ? `${p.phone.slice(1)}@phone.jasiri.app` : p.email!;
  const { data, error } = await admin.auth.admin.createUser({
    email: loginEmail, password: p.pin, email_confirm: true,
    user_metadata: { full_name: p.name, phone: p.phone ?? null, contact_email: p.email ?? null, is_barber: !!p.barber, handle: p.barber ?? null, signup_role: p.role ?? (p.barber ? "barber" : null) },
  });
  if (error) throw new Error(`${p.name}: ${error.message}`);
  return data.user.id;
}

const FIRST = ["Otieno", "Kip", "Mwangi", "Ochieng", "Kamau", "Wafula", "Njoroge", "Omondi", "Mutua", "Kiprop", "Baraka", "Juma", "Hassan", "Musa", "Tony", "Steve", "Collins", "Victor", "Ian", "Felix"];

async function main() {
  const ids: Record<string, string> = {};
  for (const p of PEOPLE) ids[p.key] = await createUser(p);
  await db.connect();
  const q = (sql: string, args: unknown[] = []) => db.query(sql, args);

  await q("update public.profiles set is_platform_admin = true where id = $1", [ids.admin]);
  await q("update public.profiles set about = $2 where id = $1", [ids.brian, "Haircut 300 · Fade 400 · Beard 100 · Kids 200"]);
  // Two barbers already paid; one trial ended without paying (shows on the kill criteria).
  await q("update public.profiles set trial_ends_at = now() - interval '3 days', paid_until = current_date + 27 where id = $1", [ids.juma]);
  await q("update public.profiles set trial_ends_at = now() - interval '2 days' where id = $1", [ids.kevin]);

  const shop = (await q(
    "insert into public.shops (name, area, join_code, created_by) values ('Kinyozi Bora', 'Kahawa West', 'KB2345', $1) returning id", [ids.juma])).rows[0].id as string;
  const member = (user: string, roles: string[], duty = false) => q(
    `insert into public.memberships (shop_id, user_id, status, roles, decided_at, decided_by, on_duty_date, requested_at)
     values ($1, $2, 'active', $3::public.shop_role[], now() - interval '20 days', $4, case when $5 then (now() at time zone 'Africa/Nairobi')::date end, now() - interval '20 days')`,
    [shop, user, `{${roles.join(",")}}`, ids.juma, duty]);
  await member(ids.juma, ["manager", "barber"]);
  await member(ids.brian, ["barber"]);
  await member(ids.kevin, ["barber"]);
  await member(ids.mary, ["service_staff"], true);
  await member(ids.grace, ["service_staff", "cashier"], true);
  await member(ids.cashier, ["cashier"]);

  // Client books: same client number can exist with two barbers as separate records.
  const barbers = [ids.juma, ids.brian, ids.kevin];
  const books: Record<string, { id: string; name: string }[]> = {};
  let n = 0;
  for (const b of barbers) {
    books[b] = [];
    for (let i = 0; i < 14; i++) {
      n++;
      const name = FIRST[(i + barbers.indexOf(b) * 5) % FIRST.length];
      const phone = `+2547${String(30000000 + n * 7919).slice(0, 8)}`;
      const r = await q(
        `insert into public.clients (barber_id, first_name, phone, consent_version, consented_at, created_at)
         values ($1, $2, $3, 'consent-v1', now() - interval '30 days', now() - interval '30 days') returning id`, [b, name, phone]);
      books[b].push({ id: r.rows[0].id, name });
    }
  }

  const staff = [ids.mary, ids.grace];
  const today = new Date(new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Nairobi" }).format(new Date()) + "T00:00:00+03:00");

  async function code(opts: {
    barber: string | null; at: Date; amount: number; client?: { id: string; name: string } | null;
    lines?: { by: string; amount: number; note: string }[]; staff?: string | null;
    end: "paid" | "open" | "voided" | "created"; paidAmount?: number; voidReason?: string; voidBy?: string;
  }) {
    const created = opts.at;
    const confirmed = new Date(created.getTime() + 60_000);
    const status = opts.end === "created" ? "created" : "open";
    const r = await q(
      `insert into public.codes (shop_id, display_code, barber_id, created_by, client_id, client_first_name, has_client_phone,
         status, barber_amount, created_at, confirmed_at, assigned_staff_id, assigned_at, service_status, service_confirmed_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$11,$13,$14) returning id`,
      [shop, displayCode(), opts.barber, opts.barber ?? opts.staff, opts.client?.id ?? null, opts.client?.name ?? null, !!opts.client,
       status, opts.amount, created, status === "open" ? confirmed : null, opts.staff ?? null,
       opts.lines?.length ? "in_progress" : "pending", opts.lines?.length ? new Date(confirmed.getTime() + 5 * 60_000) : null]);
    const id = r.rows[0].id as string;
    for (const l of opts.lines ?? []) {
      await q(`insert into public.code_service_lines (code_id, shop_id, performed_by, amount, note, added_at) values ($1,$2,$3,$4,$5,$6)`,
        [id, shop, l.by, l.amount, l.note, new Date(confirmed.getTime() + 10 * 60_000)]);
    }
    const total = opts.amount + (opts.lines ?? []).reduce((a, l) => a + l.amount, 0);
    if (opts.end === "paid") {
      const paidAt = new Date(confirmed.getTime() + (12 + Math.floor(rand() * 25)) * 60_000);
      await q(`update public.codes set status='paid', paid_at=$2, paid_by=$3, amount_paid=$4,
                 service_status = case when $5 then 'done'::public.service_status else 'skipped' end, service_done_at=$2 where id=$1`,
        [id, paidAt, ids.cashier, opts.paidAmount ?? total, (opts.lines ?? []).length > 0]);
    } else if (opts.end === "voided") {
      await q(`update public.codes set status='voided', voided_at=$2, voided_by=$3, void_reason=$4 where id=$1`,
        [id, new Date(confirmed.getTime() + 3 * 60_000), opts.voidBy ?? ids.cashier, opts.voidReason ?? "mistake"]);
    }
    return id;
  }

  for (let d = 13; d >= 0; d--) {
    const day = new Date(today.getTime() - d * 86400_000);
    for (const b of barbers) {
      const count = 6 + Math.floor(rand() * 6);
      for (let i = 0; i < count; i++) {
        const at = new Date(day.getTime() + (9 * 60 + Math.floor(rand() * 600)) * 60_000);
        if (d === 0 && at > new Date()) continue;
        const withService = rand() < 0.85;
        const lines = withService ? [{ by: pick(staff), amount: 100, note: "Head wash" }] : [];
        if (withService && rand() < 0.3) lines.push({ by: lines[0].by, amount: pick([200, 300]), note: pick(["Massage", "Facial"]) });
        const isToday = d === 0;
        const end = isToday && rand() < 0.3 ? "open" : "paid";
        await code({ barber: b, at, amount: pick([200, 300, 300, 400, 500]), client: rand() < 0.8 ? pick(books[b]) : null,
          lines, staff: withService ? lines[0].by : null, end });
      }
    }
  }

  // Planted problems for the flags.
  const day3 = new Date(today.getTime() - 3 * 86400_000 + 14 * 3600_000);
  await code({ barber: ids.brian, at: day3, amount: 300, client: books[ids.brian][0], staff: ids.mary, end: "open" }); // open after day
  await code({ barber: ids.kevin, at: new Date(day3.getTime() + 3600_000), amount: 400, staff: ids.grace, end: "open" });
  await code({ barber: ids.juma, at: new Date(day3.getTime() + 2 * 3600_000), amount: 300, client: books[ids.juma][1],
    lines: [{ by: ids.mary, amount: 100, note: "Head wash" }], staff: ids.mary, end: "paid", paidAmount: 300 }); // mismatch
  const voidAt = new Date(today.getTime() - 2 * 86400_000 + 15 * 3600_000);
  await code({ barber: ids.brian, at: voidAt, amount: 300, client: { id: books[ids.brian][2].id, name: "Tony" }, end: "voided", voidReason: "mistake" });
  const kevTony = books[ids.kevin].find((c) => c.name === "Tony") ?? books[ids.kevin][0];
  await code({ barber: ids.kevin, at: new Date(voidAt.getTime() + 8 * 60_000), amount: 300, client: { id: kevTony.id, name: "Tony" }, staff: ids.grace,
    lines: [{ by: ids.grace, amount: 100, note: "Head wash" }], end: "paid" }); // void + recreate under another barber
  await code({ barber: ids.kevin, at: new Date(voidAt.getTime() + 3600_000), amount: 200, end: "voided", voidReason: "left_without_paying" });
  const handed = await code({ barber: ids.juma, at: new Date(today.getTime() - 86400_000 + 11 * 3600_000), amount: 300, staff: ids.grace,
    lines: [{ by: ids.grace, amount: 300, note: "Massage" }], end: "paid" });
  await q(`insert into public.code_handovers (code_id, shop_id, from_staff, to_staff, by_user, at)
           values ($1, $2, $3, $4, $3, now() - interval '1 day')`, [handed, shop, ids.mary, ids.grace]);
  // A service-only code today.
  await code({ barber: null, at: new Date(Date.now() - 40 * 60_000), amount: 0, staff: ids.mary,
    lines: [{ by: ids.mary, amount: 300, note: "Facial" }], end: "open" });

  // Bookable times for every barber: Mon–Sat 09:00–13:00 and 14:00–19:00.
  for (const b of barbers) {
    for (let wd = 1; wd <= 6; wd++) {
      await q("insert into public.availability_rules (barber_id, weekday, start_time, end_time) values ($1,$2,'09:00','13:00'), ($1,$2,'14:00','19:00')", [b, wd]);
    }
  }
  // Past bookings (link and manual, some no-shows) and upcoming ones.
  for (let d = 10; d >= -3; d--) {
    for (const b of barbers) {
      if (rand() < 0.4) continue;
      const start = new Date(today.getTime() - d * 86400_000 + (10 + Math.floor(rand() * 8)) * 3600_000);
      const status = d > 0 ? (rand() < 0.15 ? "no_show" : "completed") : "booked";
      await q(`insert into public.bookings (barber_id, client_id, slot_start, slot_end, status, source, created_at)
               values ($1,$2,$3,$4,$5,$6,$7) on conflict do nothing`,
        [b, pick(books[b]).id, start, new Date(start.getTime() + 30 * 60_000), status, rand() < 0.45 ? "link" : "manual",
         new Date(start.getTime() - 2 * 86400_000)]).catch(() => undefined);
    }
  }
  await q("insert into public.problem_reports (shop_id, reporter_id, note) values ($1, $2, 'Code 3 days ago still open, client paid cash.')", [shop, ids.brian]);

  await db.end();
  console.log("Seeded. Sign in with:");
  for (const p of PEOPLE) console.log(`  ${p.name.padEnd(22)} ${p.phone ? "0" + p.phone.slice(4) : p.email}  PIN ${p.pin}`);
}

main().catch(async (e) => { console.error(e); await db.end().catch(() => {}); process.exit(1); });
