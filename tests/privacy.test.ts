import { describe, it, expect, beforeAll } from "vitest";
import { call, read, errorOf, newShop, newUser, service, randomPhone, type Shop } from "./helpers";

let shop: Shop;
let codeId: string;
const clientPhone = randomPhone();
const local = "0" + clientPhone.slice(4);
beforeAll(async () => {
  shop = await newShop();
  const c = await call(shop.barber, "create_code", {
    p_shop: shop.id, p_amount: 300, p_new_first_name: "Wekesa", p_new_phone: local, p_consent: true,
  });
  await call(shop.barber, "confirm_code", { p_code: c.id });
  codeId = c.id;
});

describe("client privacy", () => {
  it("8. a barber can't read another barber's clients; nobody else ever gets a client phone number", async () => {
    const mine = await read(shop.barber, "my_client_book");
    expect(mine.map((c: any) => c.phone)).toContain(clientPhone);

    for (const u of [shop.manager, shop.staff, shop.cashier]) {
      const { data } = await u.client.from("clients").select("*");
      expect(data).toEqual([]);
      const book = await read(u, "my_client_book");
      expect(JSON.stringify(book)).not.toContain(clientPhone);
    }
    // Same number with another barber is a separate record he can't see.
    await call(shop.manager, "add_client", { p_first_name: "Wekesa", p_phone: clientPhone, p_consent: true });
    const managerBook = await read(shop.manager, "my_client_book");
    expect(managerBook).toHaveLength(1);
    expect((await read(shop.barber, "my_client_book")).length).toBe(1);

    const everything = JSON.stringify([
      await read(shop.cashier, "cashier_codes", { p_shop: shop.id }),
      await read(shop.staff, "service_queue", { p_shop: shop.id }),
      await read(shop.manager, "shop_flags", { p_shop: shop.id, p_from: "2020-01-01", p_to: "2100-01-01" }),
      await read(shop.manager, "shop_usage", { p_shop: shop.id, p_from: "2020-01-01", p_to: "2100-01-01" }),
      (await shop.manager.client.from("codes").select("*")).data,
      (await shop.cashier.client.from("codes").select("*")).data,
      (await shop.manager.client.from("audit_log").select("*").eq("shop_id", shop.id)).data,
    ]);
    expect(everything).toContain("Wekesa");
    expect(everything).not.toContain(clientPhone.slice(4));

    // Colleagues' own phone numbers aren't exposed either: only names.
    const { error } = await shop.manager.client.from("profiles").select("phone");
    expect(error?.message).toMatch(/permission denied/);
  });

  it("13. the public booking page never shows a stored client name", async () => {
    const { data: me } = await shop.barber.client.rpc("my_profile");
    await call(shop.barber, "set_availability", {
      p_rules: [0, 1, 2, 3, 4, 5, 6].map((w) => ({ weekday: w, start_time: "00:00", end_time: "23:30" })), p_slot_minutes: 30,
    });
    const page = await service.rpc("public_barber_page", { p_handle: me.handle });
    expect(JSON.stringify(page.data)).not.toContain("Wekesa");
    const known = await service.rpc("public_phone_known", { p_handle: me.handle, p_phone: local });
    expect(known.data).toBe(true);
    const booked = await service.rpc("public_book", {
      p_request: crypto.randomUUID(), p_handle: me.handle, p_slot_start: page.data.slots[2], p_phone: local,
    });
    expect(booked.error).toBeNull();
    expect(JSON.stringify(booked.data)).not.toContain("Wekesa");
    expect(booked.data.masked_phone).toBe(`0${clientPhone[4]}XX XXX ${clientPhone.slice(-3)}`);
    const again = await service.rpc("public_booking", { p_token: booked.data.cancel_token });
    expect(JSON.stringify(again.data)).not.toContain("Wekesa");
    // Signed-in users can't call the public functions directly.
    const { error } = await shop.cashier.client.rpc("public_phone_known", { p_handle: me.handle, p_phone: local });
    expect(error?.message).toMatch(/permission denied/);
  });

  it("platform admin can delete a client record; past codes stay without the client", async () => {
    const admin = await newUser();
    await service.from("profiles").update({ is_platform_admin: true }).eq("id", admin.id);
    const found = await read(admin, "admin_find_clients", { p_phone: local });
    expect(found.length).toBe(2);
    const barberClient = (await read(shop.barber, "my_client_book"))[0];
    await call(admin, "admin_delete_client", { p_client: barberClient.id });
    expect(await read(shop.barber, "my_client_book")).toEqual([]);
    const { data: code } = await service.from("codes").select("client_id, client_first_name, status").eq("id", codeId).single();
    expect(code).toEqual({ client_id: null, client_first_name: null, status: "open" });
    expect(await errorOf(call(shop.manager, "admin_delete_client", { p_client: barberClient.id }))).toBe("not_allowed");
  });
});
