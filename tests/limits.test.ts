import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { service, anon } from "./helpers";

describe("14. rate limits and PIN lockout (no SMS in this version)", () => {
  it("counts per key inside a window and blocks past the limit", async () => {
    const key = `test:${randomUUID()}`;
    const results = [];
    for (let i = 0; i < 6; i++) results.push((await service.rpc("hit_rate_limit", { p_key: key, p_limit: 5, p_window_seconds: 600 })).data);
    expect(results).toEqual([true, true, true, true, true, false]);
    // A different phone number or IP has its own counter.
    expect((await service.rpc("hit_rate_limit", { p_key: `${key}-other`, p_limit: 5, p_window_seconds: 600 })).data).toBe(true);
  });

  it("locks an account for 15 minutes after 5 wrong PINs", async () => {
    const id = `${randomUUID()}@phone.jasiri.app`;
    for (let i = 0; i < 4; i++) await service.rpc("login_record", { p_identifier: id, p_success: false });
    expect((await service.rpc("login_wait_seconds", { p_identifier: id })).data).toBe(0);
    await service.rpc("login_record", { p_identifier: id, p_success: false });
    const wait = (await service.rpc("login_wait_seconds", { p_identifier: id })).data;
    expect(wait).toBeGreaterThan(800);
    expect(wait).toBeLessThanOrEqual(900);
  });

  it("the rate-limit and login functions can't be called from a browser", async () => {
    const { error } = await anon().rpc("hit_rate_limit", { p_key: "x", p_limit: 1, p_window_seconds: 1 });
    expect(error?.message).toMatch(/permission denied/);
    const r = await anon().rpc("public_book", { p_request: randomUUID(), p_handle: "x", p_slot_start: new Date().toISOString(), p_phone: "0711000000" });
    expect(r.error?.message).toMatch(/permission denied/);
  });
});
