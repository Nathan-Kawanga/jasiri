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
    expect(n).toBe(2);
  });

  it("limits a barber to 30 lookups an hour", async () => {
    const shop = await newShop();
    for (let i = 0; i < 30; i++) await read(shop.barber, "shop_client_lookup", { p_shop: shop.id, p_phone: `07120${String(i).padStart(5, "0")}` });
    expect(await errorOf(read(shop.barber, "shop_client_lookup", { p_shop: shop.id, p_phone: "0712099999" }))).toBe("rate_limited");
  });
});
