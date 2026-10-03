import { describe, it, expect } from "vitest";
import { call, read, errorOf, newUser, service } from "./helpers";

const png = new Blob([Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="), (c) => c.charCodeAt(0))], { type: "image/png" });

describe("barber photos", () => {
  it("a barber writes only in his own folder; others can't add photos; max 12; public page shows them", async () => {
    const a = await newUser({ barber: true });
    const b = await newUser({ barber: true });
    const staff = await newUser();

    const own = await a.client.storage.from("portfolio").upload(`${a.id}/one.png`, png, { contentType: "image/png" });
    expect(own.error).toBeNull();
    const other = await a.client.storage.from("portfolio").upload(`${b.id}/hack.png`, png, { contentType: "image/png" });
    expect(other.error).not.toBeNull();

    expect(await errorOf(call(a, "add_portfolio_photo", { p_path: `${b.id}/hack.png` }))).toBe("not_allowed");
    expect(await errorOf(call(staff, "add_portfolio_photo", { p_path: `${staff.id}/x.png` }))).toBe("not_allowed");

    await call(a, "add_portfolio_photo", { p_path: `${a.id}/one.png`, p_caption: "Taper fade" });
    for (let i = 0; i < 11; i++) await call(a, "add_portfolio_photo", { p_path: `${a.id}/p${i}.png` });
    expect(await errorOf(call(a, "add_portfolio_photo", { p_path: `${a.id}/p99.png` }))).toBe("too_many_photos");

    await call(a, "set_my_photo", { p_path: `${a.id}/one.png` });
    const handle = (await read(a, "my_profile")).handle;
    const page = await service.rpc("public_barber_page", { p_handle: handle });
    expect(page.data.photos).toHaveLength(12);
    expect(page.data.photo_path).toBe(`${a.id}/one.png`);

    const [first] = (await a.client.from("portfolio_photos").select("id")).data!;
    expect(await errorOf(call(b, "remove_portfolio_photo", { p_photo: first.id }))).toBe("not_found");
    expect((await call(a, "remove_portfolio_photo", { p_photo: first.id })).path).toMatch(new RegExp(`^${a.id}/`));
  });
});
