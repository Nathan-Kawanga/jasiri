import { describe, it, expect, beforeAll } from "vitest";
import { randomUUID } from "node:crypto";
import { call, read, errorOf, newShop, newUser, openCode, service, sql, anon, type Shop } from "./helpers";

let shop: Shop;
beforeAll(async () => { shop = await newShop(); });

describe("code chain rules", () => {
  it("1. two barbers creating codes at the same moment never share a display code, and each code keeps its barber", async () => {
    const make = (u: typeof shop.barber) => call(u, "create_code", { p_shop: shop.id, p_amount: 300, p_anonymous: true });
    const results = await Promise.all(Array.from({ length: 40 }, (_, i) => make(i % 2 ? shop.barber : shop.manager)));
    const codes = results.map((r) => r.display_code);
    expect(new Set(codes).size).toBe(codes.length);
    const rows = await sql("select id, barber_id, display_code from public.codes where id = any($1)", [results.map((r) => r.id)]);
    for (const [i, r] of results.entries()) {
      const row = rows.find((x) => x.id === r.id)!;
      expect(row.barber_id).toBe(i % 2 ? shop.barber.id : shop.manager.id);
    }
  });

  it("2. nobody can change the barber on a code: not the manager, not the service role, not the database superuser", async () => {
    const id = await openCode(shop);
    // Signed-in users (manager, platform admin) have no write access to the table at all.
    const admin = await newUser();
    await sql("update public.profiles set is_platform_admin = true where id = $1", [admin.id]);
    for (const u of [shop.manager, admin]) {
      const { error } = await u.client.from("codes").update({ barber_id: shop.manager.id }).eq("id", id);
      expect(error?.message).toMatch(/permission denied/);
    }
    // The service key bypasses RLS, but the trigger still refuses.
    const { error } = await service.from("codes").update({ barber_id: shop.manager.id }).eq("id", id);
    expect(error?.message).toBe("barber_cannot_change");
    expect(await errorOf(sql("update public.codes set barber_id = $2 where id = $1", [id, shop.manager.id]))).toBe("barber_cannot_change");
    expect(await errorOf(sql("update public.codes set barber_id = null where id = $1", [id]))).toBe("barber_cannot_change");
    const [row] = await sql("select barber_id from public.codes where id = $1", [id]);
    expect(row.barber_id).toBe(shop.barber.id);
  });

  it("3. a code becomes paid once; a paid code can't be voided or edited", async () => {
    const id = await openCode(shop);
    const paid = await call(shop.cashier, "pay_code", { p_code: id, p_amount_paid: 300 });
    expect(paid.status).toBe("paid");
    expect(await errorOf(call(shop.cashier, "pay_code", { p_code: id, p_amount_paid: 300 }))).toBe("already_paid");
    expect(await errorOf(call(shop.cashier, "void_code", { p_code: id, p_reason: "mistake" }))).toBe("code_is_final");
    expect(await errorOf(call(shop.manager, "void_code", { p_code: id, p_reason: "mistake" }))).toBe("code_is_final");
    expect(await errorOf(sql("update public.codes set amount_paid = 1 where id = $1", [id]))).toBe("code_is_final");
    expect(await errorOf(sql("update public.codes set status = 'open', paid_at = null, amount_paid = null where id = $1", [id]))).toBe("code_is_final");
    expect(await errorOf(sql("delete from public.codes where id = $1", [id]))).toBe("codes_cannot_be_deleted");
  });

  it("4. paying fails before the client confirms, and from a cashier in another shop", async () => {
    const c = await call(shop.barber, "create_code", { p_shop: shop.id, p_amount: 300, p_anonymous: true });
    expect(await errorOf(call(shop.cashier, "pay_code", { p_code: c.id, p_amount_paid: 300 }))).toBe("code_not_open");
    await call(shop.barber, "confirm_code", { p_code: c.id });
    const other = await newShop();
    expect(await errorOf(call(other.cashier, "pay_code", { p_code: c.id, p_amount_paid: 300 }))).toBe("not_allowed");
    // Barbers, service staff and managers can't mark paid either; only a cashier of this shop.
    for (const u of [shop.barber, shop.staff, shop.manager]) {
      expect(await errorOf(call(u, "pay_code", { p_code: c.id, p_amount_paid: 300 }))).toBe("not_allowed");
    }
    const voided = await call(shop.barber, "create_code", { p_shop: shop.id, p_amount: 300, p_anonymous: true });
    await call(shop.barber, "confirm_code", { p_code: voided.id });
    await call(shop.cashier, "void_code", { p_code: voided.id, p_reason: "duplicate" });
    expect(await errorOf(call(shop.cashier, "pay_code", { p_code: voided.id, p_amount_paid: 300 }))).toBe("code_not_open");
  });

  it("5. earnings count only paid codes; open and voided codes still show in the person's own list", async () => {
    const s = await newShop();
    const paid = await openCode(s, s.barber, 400);
    await call(s.staff, "add_service_line", { p_code: paid, p_amount: 100, p_note: "wash" });
    await call(s.staff, "finish_service", { p_code: paid });
    await call(s.cashier, "pay_code", { p_code: paid, p_amount_paid: 500 });
    const open = await openCode(s, s.barber, 300);
    await call(s.staff, "add_service_line", { p_code: open, p_amount: 150 });
    const voided = await openCode(s, s.barber, 200);
    await call(s.cashier, "void_code", { p_code: voided, p_reason: "left_without_paying" });

    const today = (await sql("select private.today()::text as d"))[0].d;
    const b = await read(s.barber, "my_earnings", { p_from: today, p_to: today });
    expect(b.verified_amount).toBe(400);
    expect(b.verified_count).toBe(1);
    expect(b.open_amount).toBe(300);
    expect(b.voided_count).toBe(1);
    expect(b.rows.map((r: any) => r.verification).sort()).toEqual(["cashier_confirmed", "self_recorded", "voided"]);

    const st = await read(s.staff, "my_earnings", { p_from: today, p_to: today });
    expect(st.verified_amount).toBe(100);
    expect(st.open_amount).toBe(150);

    const sheet = await read(s.cashier, "payout_sheet", { p_shop: s.id, p_day: today });
    const barberRow = sheet.rows.find((r: any) => r.user_id === s.barber.id);
    expect(barberRow.paid_amount).toBe(400);
    expect(barberRow.open_count).toBe(1);
  });

  it("6. amounts are fixed once the client confirms; later edits never rewrite a code", async () => {
    const id = await openCode(shop, shop.barber, 300);
    expect(await errorOf(sql("update public.codes set barber_amount = 999 where id = $1", [id]))).toBe("amount_locked");
    await call(shop.staff, "add_service_line", { p_code: id, p_amount: 100 });
    const [line] = await sql("select id from public.code_service_lines where code_id = $1", [id]);
    expect(await errorOf(sql("update public.code_service_lines set amount = 5 where id = $1", [line.id]))).toBe("field_cannot_change");
    await call(shop.cashier, "pay_code", { p_code: id, p_amount_paid: 400 });
    expect(await errorOf(sql("insert into public.code_service_lines (code_id, shop_id, performed_by, amount) values ($1,$2,$3,50)", [id, shop.id, shop.staff.id]))).toBe("code_is_final");
    const [row] = await sql("select barber_amount, amount_paid from public.codes where id = $1", [id]);
    expect(row).toEqual({ barber_amount: 300, amount_paid: 400 });
  });

  it("9. a double tap or retry creates one code and one paid event", async () => {
    const rid = randomUUID();
    const args = { p_shop: shop.id, p_amount: 300, p_anonymous: true };
    const [a, b, c] = await Promise.all([1, 2, 3].map(() => call(shop.barber, "create_code", args, rid)));
    expect(a.id).toBe(b.id);
    expect(b.id).toBe(c.id);
    const [{ n }] = await sql("select count(*)::int n from public.audit_log where action = 'code.create' and entity_id = $1", [a.id]);
    expect(n).toBe(1);
    await call(shop.barber, "confirm_code", { p_code: a.id });

    const payId = randomUUID();
    const pays = await Promise.all([1, 2, 3].map(() => call(shop.cashier, "pay_code", { p_code: a.id, p_amount_paid: 300 }, payId)));
    expect(pays.every((p) => p.status === "paid")).toBe(true);
    const [{ m }] = await sql("select count(*)::int m from public.audit_log where action = 'code.pay' and entity_id = $1", [a.id]);
    expect(m).toBe(1);
  });

  it("12. every state change writes an audit entry; audit entries can't be changed or deleted", async () => {
    const id = await openCode(shop);
    await call(shop.staff, "service_start", { p_code: id });
    await call(shop.staff, "add_service_line", { p_code: id, p_amount: 100 });
    await call(shop.staff, "finish_service", { p_code: id });
    await call(shop.cashier, "pay_code", { p_code: id, p_amount_paid: 400 });
    const rows = await sql("select action, actor_id, actor_roles from public.audit_log where entity_id = $1 or (entity = 'code_service_lines' and after->>'code_id' = $2) order by id", [id, id]);
    expect(rows.map((r) => r.action)).toEqual(["code.create", "code.confirm", "code.service_start", "code.service_add", "code.service_done", "code.pay"]);
    const pay = rows.at(-1)!;
    expect(pay.actor_id).toBe(shop.cashier.id);
    expect(pay.actor_roles).toContain("cashier");

    const [{ id: auditId }] = await sql("select id from public.audit_log where entity_id = $1 limit 1", [id]);
    expect(await errorOf(sql("update public.audit_log set action = 'x' where id = $1", [auditId]))).toBe("audit_log_is_append_only");
    expect(await errorOf(sql("delete from public.audit_log where id = $1", [auditId]))).toBe("audit_log_is_append_only");
    expect(await errorOf(sql("truncate public.audit_log"))).toBe("audit_log_is_append_only");
    const { error } = await shop.manager.client.from("audit_log").delete().eq("id", auditId);
    expect(error?.message).toMatch(/permission denied/);
  });

  it("15. a join request gives no access to the shop until the manager approves it", async () => {
    const s = await newShop();
    const id = await openCode(s);
    const waiting = await newUser({ barber: true });
    const { membership_id } = await call(waiting, "request_join", { p_code: s.joinCode });
    expect(await errorOf(call(waiting, "create_code", { p_shop: s.id, p_amount: 300, p_anonymous: true }))).toBe("not_allowed");
    expect(await errorOf(read(waiting, "cashier_codes", { p_shop: s.id }))).toBe("not_allowed");
    expect(await errorOf(read(waiting, "service_queue", { p_shop: s.id }))).toBe("not_allowed");
    expect(await errorOf(call(waiting, "pay_code", { p_code: id, p_amount_paid: 1 }))).toBe("not_allowed");
    expect((await waiting.client.from("codes").select("id").eq("shop_id", s.id)).data).toEqual([]);
    expect(await errorOf(call(waiting, "decide_join", { p_membership: membership_id, p_approve: true, p_roles: ["manager"] }))).toBe("not_allowed");

    await call(s.manager, "decide_join", { p_membership: membership_id, p_approve: true, p_roles: ["barber"] });
    // One vouch isn't enough in a shop of several people.
    expect(await errorOf(call(waiting, "create_code", { p_shop: s.id, p_amount: 300, p_anonymous: true }))).toBe("not_allowed");
    await call(s.barber, "decide_join", { p_membership: membership_id, p_approve: true, p_roles: ["barber"] });
    const c = await call(waiting, "create_code", { p_shop: s.id, p_amount: 300, p_anonymous: true });
    expect(c.display_code).toMatch(/^[2-9A-HJKMNP-Z]{4}$/);
  });

  it("assigns service staff on confirm, and lets the cashier see the code at the same time", async () => {
    const s = await newShop();
    const c = await call(s.barber, "create_code", { p_shop: s.id, p_amount: 300, p_anonymous: true });
    const confirmed = await call(s.barber, "confirm_code", { p_code: c.id });
    expect(confirmed.assigned_staff_id).toBe(s.staff.id);
    const q = await read(s.staff, "service_queue", { p_shop: s.id });
    expect(q.codes.map((x: any) => x.id)).toContain(c.id);
    const cash = await read(s.cashier, "cashier_codes", { p_shop: s.id });
    expect(cash.map((x: any) => x.id)).toContain(c.id);
    // The client skips service and pays straight away: nothing is recorded for the service staff.
    await call(s.cashier, "pay_code", { p_code: c.id, p_amount_paid: 300 });
    const [row] = await sql("select service_status from public.codes where id = $1", [c.id]);
    expect(row.service_status).toBe("skipped");
    // Off duty → shared Unassigned list.
    await call(s.staff, "set_on_duty", { p_shop: s.id, p_on: false });
    const c2 = await openCode(s);
    const [r2] = await sql("select assigned_staff_id from public.codes where id = $1", [c2]);
    expect(r2.assigned_staff_id).toBeNull();
  });

  it("only the barber can cancel, and only before the client confirms", async () => {
    const c = await call(shop.barber, "create_code", { p_shop: shop.id, p_amount: 300, p_anonymous: true });
    expect(await errorOf(call(shop.manager, "cancel_code", { p_code: c.id }))).toBe("not_allowed");
    await call(shop.barber, "confirm_code", { p_code: c.id });
    expect(await errorOf(call(shop.barber, "cancel_code", { p_code: c.id }))).toBe("already_confirmed");
    expect(await errorOf(call(shop.barber, "void_code", { p_code: c.id, p_reason: "mistake" }))).toBe("not_allowed");
    expect(await errorOf(call(shop.cashier, "void_code", { p_code: c.id, p_reason: "other" }))).toBe("note_required");
  });

  it("the anonymous key can call no write function", async () => {
    const { error } = await anon().rpc("create_code", { p_request: randomUUID(), p_shop: shop.id, p_amount: 1, p_anonymous: true });
    expect(error?.message).toMatch(/permission denied/);
  });
});
