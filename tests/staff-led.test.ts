import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { call, read, errorOf, newShop, newUser } from "./helpers";

describe("staff-led shops", () => {
  it("finds a shop by typing part of its name, even with a typo", async () => {
    const shop = await newShop();
    const tag = randomUUID().slice(0, 6);
    await call(shop.manager, "update_shop", { p_shop: shop.id, p_name: `Kinyozi Bora ${tag}`, p_area: "Kahawa West" });
    const u = await newUser({ role: "service_staff" });
    const byPart = await read(u, "search_shops", { p_query: `bora ${tag}` });
    expect(byPart.map((x: any) => x.id)).toContain(shop.id);
    const typo = await read(u, "search_shops", { p_query: `Kinyozi Bra ${tag}` });
    expect(typo.map((x: any) => x.id)).toContain(shop.id);
    const hit = byPart.find((x: any) => x.id === shop.id);
    expect(Object.keys(hit).sort()).toEqual(["area", "id", "members", "mine", "name"]);
    expect(hit.members).toBe(4);
  });

  it("any coworker can vouch for a new service lady or cashier; nobody else can", async () => {
    const shop = await newShop();
    const lady = await newUser({ role: "service_staff" });
    const { membership_id } = await call(lady, "request_join_shop", { p_shop: shop.id, p_role: "service_staff" });

    // Not yet in: no access.
    expect(await errorOf(read(lady, "service_queue", { p_shop: shop.id }))).toBe("not_allowed");
    // A stranger can't approve, and she can't approve herself.
    const stranger = await newUser({ barber: true });
    expect(await errorOf(call(stranger, "decide_join", { p_membership: membership_id, p_approve: true, p_roles: ["service_staff"] }))).toBe("not_allowed");
    expect(await errorOf(call(lady, "decide_join", { p_membership: membership_id, p_approve: true, p_roles: ["service_staff"] }))).toBe("not_allowed");

    // Two different coworkers must say yes. They can't hand out extra roles.
    const reqs = await read(shop.barber, "shop_join_requests", { p_shop: shop.id });
    expect(reqs.find((r: any) => r.membership_id === membership_id)).toMatchObject({ requested_role: "service_staff", can_decide: true, needed: 2, yes: 0 });
    const first = await call(shop.barber, "decide_join", { p_membership: membership_id, p_approve: true, p_roles: ["service_staff", "manager", "cashier"] });
    expect(first).toMatchObject({ result: "pending", yes: 1, needed: 2 });
    // Voting twice doesn't count twice.
    expect((await call(shop.barber, "decide_join", { p_membership: membership_id, p_approve: true, p_roles: [] })).result).toBe("pending");
    expect(await errorOf(read(lady, "service_queue", { p_shop: shop.id }))).toBe("not_allowed");
    expect((await call(shop.cashier, "decide_join", { p_membership: membership_id, p_approve: true, p_roles: [] })).result).toBe("approved");
    const mine = (await read(lady, "my_shops")).find((m: any) => m.shop_id === shop.id);
    expect(mine.roles).toEqual(["service_staff"]);
    await read(lady, "service_queue", { p_shop: shop.id });
  });

  it("one No doesn't block; two Nos turn someone away; a one-person shop needs one vouch", async () => {
    const shop = await newShop();
    const a = await newUser({ role: "cashier" });
    const { membership_id } = await call(a, "request_join_shop", { p_shop: shop.id, p_role: "cashier" });
    expect((await call(shop.barber, "decide_join", { p_membership: membership_id, p_approve: false, p_roles: [] })).result).toBe("pending");
    expect((await call(shop.staff, "decide_join", { p_membership: membership_id, p_approve: false, p_roles: [] })).result).toBe("rejected");

    const solo = await newUser({ barber: true });
    const { shop_id } = await call(solo, "create_shop", { p_name: "Solo Cuts", p_area: "Thika" });
    const b2 = await newUser({ barber: true });
    const r = await call(b2, "request_join_shop", { p_shop: shop_id, p_role: "barber" });
    expect((await call(solo, "decide_join", { p_membership: r.membership_id, p_approve: true, p_roles: [] })).result).toBe("approved");
    // Now there are two people: the next one needs both.
    const b3 = await newUser({ barber: true });
    const r3 = await call(b3, "request_join_shop", { p_shop: shop_id, p_role: "barber" });
    expect((await call(solo, "decide_join", { p_membership: r3.membership_id, p_approve: true, p_roles: [] })).result).toBe("pending");
    expect((await call(b2, "decide_join", { p_membership: r3.membership_id, p_approve: true, p_roles: [] })).result).toBe("approved");
  });

  it("only the shop's manager can approve someone joining as owner or manager", async () => {
    const shop = await newShop();
    const owner = await newUser({ role: "manager" });
    const { membership_id } = await call(owner, "request_join_shop", { p_shop: shop.id, p_role: "manager" });
    const reqs = await read(shop.barber, "shop_join_requests", { p_shop: shop.id });
    expect(reqs.find((r: any) => r.membership_id === membership_id).can_decide).toBe(false);
    expect(await errorOf(call(shop.barber, "decide_join", { p_membership: membership_id, p_approve: true, p_roles: ["manager"] }))).toBe("manager_must_approve");
    await call(shop.manager, "decide_join", { p_membership: membership_id, p_approve: true, p_roles: ["manager"] });
    expect((await read(owner, "my_shops")).find((m: any) => m.shop_id === shop.id).roles).toEqual(["manager"]);
  });

  it("whoever adds the shop becomes its manager plus the role they work as", async () => {
    const lady = await newUser({ role: "service_staff" });
    const { shop_id } = await call(lady, "create_shop", { p_name: "Lady Shop", p_area: "Ruiru" });
    expect((await read(lady, "my_shops")).find((m: any) => m.shop_id === shop_id).roles.sort()).toEqual(["manager", "service_staff"]);
    const nonBarber = await newUser({ role: "cashier" });
    expect(await errorOf(call(nonBarber, "request_join_shop", { p_shop: shop_id, p_role: "barber" }))).toBe("barber_profile_required");
  });
});
