import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { call, read, newShop, service, errorOf } from "./helpers";

const allWeek = [0, 1, 2, 3, 4, 5, 6].map((w) => ({ weekday: w, start_time: "00:00", end_time: "23:30" }));

describe("services and prices", () => {
  it("barbers and service staff keep their own price lists; the booking page shows both; prices come from the lists", async () => {
    const shop = await newShop();
    await call(shop.barber, "save_my_services", { p_items: [
      { name: "Haircut", price: 300, minutes: 30 }, { name: "Fade", price: 400, minutes: 40 }, { name: "Beard trim", price: 100 },
    ] });
    await call(shop.staff, "save_my_services", { p_items: [{ name: "Head wash", price: 100 }, { name: "Massage", price: 300 }] });
    expect((await read(shop.barber, "my_services")).map((x: any) => x.name)).toEqual(["Haircut", "Fade", "Beard trim"]);
    // Others can't read someone's list directly.
    expect((await shop.cashier.client.from("services").select("*")).data).toEqual([]);

    await call(shop.barber, "set_availability", { p_rules: allWeek, p_slot_minutes: 30 });
    const handle = (await read(shop.barber, "my_profile")).handle;
    const page = (await service.rpc("public_barber_page", { p_handle: handle })).data;
    expect(page.services.map((x: any) => `${x.name} ${x.price}`)).toEqual(["Haircut 300", "Fade 400", "Beard trim 100"]);
    expect(page.extras.map((x: any) => `${x.name} ${x.price}`)).toEqual(["Head wash 100", "Massage 300"]);

    // Client picks services; the server prices them, whatever the phone sends.
    const r = await service.rpc("public_book", {
      p_request: randomUUID(), p_handle: handle, p_slot_start: page.slots[3], p_phone: "0711987654",
      p_first_name: "Otieno", p_consent: true, p_services: ["fade", "Head wash"],
    });
    expect(r.error).toBeNull();
    expect(r.data.services).toEqual([
      { name: "Fade", price: 400, kind: "barber" }, { name: "Head wash", price: 100, kind: "extra" },
    ]);
    const bad = await service.rpc("public_book", {
      p_request: randomUUID(), p_handle: handle, p_slot_start: page.slots[6], p_phone: "0711987655",
      p_first_name: "X", p_consent: true, p_services: ["Free cut"],
    });
    expect(bad.error?.message).toBe("service_not_found");

    const upcoming = await read(shop.barber, "my_upcoming_bookings");
    expect(upcoming.find((b: any) => b.client_first_name === "Otieno").services.map((s: any) => s.name)).toEqual(["Fade", "Head wash"]);

    // Saving again replaces the list; signed-in users still can't call the public booking function.
    await call(shop.barber, "save_my_services", { p_items: [{ name: "Haircut", price: 350 }] });
    expect((await read(shop.barber, "my_services")).map((x: any) => x.price)).toEqual([350]);
    expect(await errorOf(read(shop.barber, "public_book", { p_request: randomUUID(), p_handle: handle, p_slot_start: page.slots[8], p_phone: "0711000000" }))).toMatch(/permission denied/);
  });
});
