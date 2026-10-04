import { describe, it, expect } from "vitest";
import { call, read, errorOf, newShop, sql } from "./helpers";

describe("same client, another barber in the same shop", () => {
  it("finds a client served in this shop by exact number, returns only the first name, and adds him to the second book", async () => {
    const shop = await newShop();
    const c = await call(shop.manager, "create_code", { p_shop: shop.id, p_amount: 300, p_new_first_name: "Kevin", p_new_phone: "0712 000 111", p_consent: true });
    await call(shop.manager, "confirm_code", { p_code: c.id });

    const found = await read(shop.barber, "shop_client_lookup", { p_shop: shop.id, p_phone: "0712000111" });
    expect(found).toEqual({ status: "shop", first_name: "Kevin" });
    expect(JSON.stringify(found)).not.toContain("712000111");

    // No match for a number never served here, and no partial matching.
    expect((await read(shop.barber, "shop_client_lookup", { p_shop: shop.id, p_phone: "0712000112" })).status).toBe("new");

    // Second barber adds him with consent; both books now have him, B1's record untouched.
    await call(shop.barber, "create_code", { p_shop: shop.id, p_amount: 300, p_new_first_name: found.first_name, p_new_phone: "0712000111", p_consent: true });
    expect((await read(shop.barber, "my_client_book")).map((x: any) => x.first_name)).toEqual(["Kevin"]);
    expect((await read(shop.manager, "my_client_book")).map((x: any) => x.first_name)).toEqual(["Kevin"]);

    // Now it's in his own book.
    expect((await read(shop.barber, "shop_client_lookup", { p_shop: shop.id, p_phone: "0712000111" })).status).toBe("mine");

    // Another shop's barber can't find him; non-barbers can't look up at all.
    const other = await newShop();
    expect((await read(other.barber, "shop_client_lookup", { p_shop: other.id, p_phone: "0712000111" })).status).toBe("new");
    expect(await errorOf(read(other.barber, "shop_client_lookup", { p_shop: shop.id, p_phone: "0712000111" }))).toBe("not_allowed");
    expect(await errorOf(read(shop.cashier, "shop_client_lookup", { p_shop: shop.id, p_phone: "0712000111" }))).toBe("not_allowed");

    const [{ n }] = await sql("select count(*)::int n from public.audit_log where action = 'client.lookup' and actor_id = $1", [shop.barber.id]);
    expect(n).toBe(2);  // "mine" lookups aren't logged or counted
  });

  it("allows 1 successful find per hour and 10 per day; misses don't count; over the limit reveals nothing", async () => {
    const shop = await newShop();
    const phones = ["0713000001", "0713000002"];
    for (const p of phones) {
      const c = await call(shop.manager, "create_code", { p_shop: shop.id, p_amount: 300, p_new_first_name: "Client", p_new_phone: p, p_consent: true });
      await call(shop.manager, "confirm_code", { p_code: c.id });
    }
    // Many new-client lookups in a row: never blocked.
    for (let i = 0; i < 5; i++) expect((await read(shop.barber, "shop_client_lookup", { p_shop: shop.id, p_phone: `07139${String(i).padStart(5, "0")}` })).status).toBe("new");
    // First find works; the second within the hour answers like an unknown number.
    expect((await read(shop.barber, "shop_client_lookup", { p_shop: shop.id, p_phone: phones[0] })).status).toBe("shop");
    expect(await read(shop.barber, "shop_client_lookup", { p_shop: shop.id, p_phone: phones[1] })).toEqual({ status: "new" });

    // Move the earlier find back 2 hours: one more find is allowed.
    await sql("alter table public.audit_log disable trigger audit_log_no_update");
    await sql("update public.audit_log set at = now() - interval '2 hours' where actor_id = $1 and action = 'client.lookup'", [shop.barber.id]);
    await sql("alter table public.audit_log enable trigger audit_log_no_update");
    expect((await read(shop.barber, "shop_client_lookup", { p_shop: shop.id, p_phone: phones[1] })).status).toBe("shop");
  });

  it("caps number guessing at 60 misses a day", async () => {
    const shop = await newShop();
    for (let i = 0; i < 60; i++) await read(shop.barber, "shop_client_lookup", { p_shop: shop.id, p_phone: `07140${String(i).padStart(5, "0")}` });
    expect(await errorOf(read(shop.barber, "shop_client_lookup", { p_shop: shop.id, p_phone: "0714099999" }))).toBe("rate_limited");
  });
});
