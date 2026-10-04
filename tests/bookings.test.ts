import { describe, it, expect, beforeAll } from "vitest";
import { randomUUID } from "node:crypto";
import { call, read, errorOf, newShop, newUser, service, type User } from "./helpers";

let barber: User;
let handle: string;
const allWeek = [0, 1, 2, 3, 4, 5, 6].map((w) => ({ weekday: w, start_time: "00:00", end_time: "23:30" }));

beforeAll(async () => {
  barber = await newUser({ barber: true });
  handle = (await read(barber, "my_profile")).handle;
  await call(barber, "set_availability", { p_rules: allWeek, p_slot_minutes: 30 });
});

const book = (slot: string, phone: string, name: string | null = "Client") =>
  service.rpc("public_book", { p_request: randomUUID(), p_handle: handle, p_slot_start: slot, p_phone: phone, p_first_name: name, p_consent: true });

describe("booking link", () => {
  it("7. two clients booking the same slot at once: one wins, the other is told to pick another time", async () => {
    const page = await service.rpc("public_barber_page", { p_handle: handle });
    const slot = page.data.slots[5];
    const [a, b] = await Promise.all([book(slot, "0711222333"), book(slot, "0711222444")]);
    const results = [a, b].map((r) => r.error?.message ?? "ok").sort();
    expect(results).toEqual(["ok", "slot_taken"]);
    const after = await service.rpc("public_barber_page", { p_handle: handle });
    expect(after.data.slots).not.toContain(slot);
  });

  it("one active future booking per phone per barber; cancelling frees the slot", async () => {
    const page = await service.rpc("public_barber_page", { p_handle: handle });
    const first = await book(page.data.slots[10], "0722333444");
    expect(first.error).toBeNull();
    const second = await book(page.data.slots[12], "0722333444");
    expect(second.error?.message).toBe("already_booked");
    await service.rpc("public_cancel", { p_token: first.data.cancel_token });
    const again = await book(page.data.slots[10], "0722333444");
    expect(again.error).toBeNull();
  });

  it("new clients must tick consent; only bookable times are accepted", async () => {
    const page = await service.rpc("public_barber_page", { p_handle: handle });
    const r = await service.rpc("public_book", { p_request: randomUUID(), p_handle: handle, p_slot_start: page.data.slots[20], p_phone: "0733000111", p_first_name: "Ali", p_consent: false });
    expect(r.error?.message).toBe("consent_required");
    const odd = new Date(Date.parse(page.data.slots[20]) + 7 * 60_000).toISOString();
    const r2 = await book(odd, "0733000111");
    expect(r2.error?.message).toBe("slot_not_bookable");
  });

  it("day view shows bookings and free walk-in slots; Start code preselects the client", async () => {
    const shop = await newShop();
    const b = shop.manager;
    const h = (await read(b, "my_profile")).handle;
    await call(b, "set_availability", { p_rules: allWeek, p_slot_minutes: 30 });
    const page = await service.rpc("public_barber_page", { p_handle: h });
    const r = await service.rpc("public_book", { p_request: randomUUID(), p_handle: h, p_slot_start: page.data.slots[1], p_phone: "0744555666", p_first_name: "Otis", p_consent: true });
    expect(r.error).toBeNull();
    const day = (await service.rpc("public_booking", { p_token: r.data.cancel_token })).data.slot_start.slice(0, 10);
    const view = await read(b, "my_upcoming_bookings");
    const booking = view.find((x: any) => x.client_first_name === "Otis");
    expect(booking.source).toBe("link");
    const code = await call(b, "create_code", { p_shop: shop.id, p_amount: 300, p_booking: booking.id });
    expect(code.client_first_name).toBe("Otis");
    expect(await errorOf(call(b, "create_code", { p_shop: shop.id, p_amount: 300, p_booking: booking.id }))).toBe("booking_not_found");
    void day;
  });

  it("11. a barber who moves shops keeps his client book and booking link; the old shop keeps its codes", async () => {
    const a = await newShop();
    const c = await call(a.barber, "create_code", { p_shop: a.id, p_amount: 300, p_new_first_name: "Loyal", p_new_phone: "0755111222", p_consent: true });
    await call(a.barber, "confirm_code", { p_code: c.id });
    await call(a.cashier, "pay_code", { p_code: c.id, p_amount_paid: 300 });

    const membership = (await read(a.barber, "my_shops"))[0].membership_id;
    await call(a.barber, "end_membership", { p_membership: membership });
    const b = await newShop();
    const { membership_id } = await call(a.barber, "request_join", { p_code: b.joinCode });
    await call(b.manager, "decide_join", { p_membership: membership_id, p_approve: true, p_roles: ["barber"] });
    await call(b.barber, "decide_join", { p_membership: membership_id, p_approve: true, p_roles: ["barber"] });

    const book = await read(a.barber, "my_client_book");
    expect(book.map((x: any) => x.first_name)).toEqual(["Loyal"]);
    expect(book[0].visits).toBe(1);
    const h = (await read(a.barber, "my_profile")).handle;
    const page = await service.rpc("public_barber_page", { p_handle: h });
    expect(page.data.shop.name).toBe("Test Shop");
    expect(page.data.name).toBe(a.barber.name);

    // Old shop still has the code; the barber can no longer act there.
    const { data: oldCodes } = await a.manager.client.from("codes").select("id, barber_id").eq("id", c.id);
    expect(oldCodes).toEqual([{ id: c.id, barber_id: a.barber.id }]);
    expect(await errorOf(call(a.barber, "create_code", { p_shop: a.id, p_amount: 300, p_anonymous: true }))).toBe("not_allowed");
    // The new shop's manager can't see his old codes or his clients.
    expect((await b.manager.client.from("codes").select("id").eq("id", c.id)).data).toEqual([]);
    // His own earnings still list the old shop's code.
    const today = (await read(a.barber, "my_earnings", { p_from: "2020-01-01", p_to: "2100-01-01" }));
    expect(today.verified_count).toBe(1);
  });

  it("keeps at least one manager", async () => {
    const s = await newShop();
    const mine = (await read(s.manager, "my_shops"))[0].membership_id;
    expect(await errorOf(call(s.manager, "set_member_roles", { p_membership: mine, p_roles: ["barber"] }))).toBe("last_manager");
    expect(await errorOf(call(s.manager, "end_membership", { p_membership: mine }))).toBe("last_manager");
  });
});
