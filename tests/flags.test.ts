import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { URL, ANON, sql } from "./helpers";

// Uses the demo data from `npm run seed`, which plants problems on purpose.
describe("10. flags fire on the seeded demo shop", () => {
  it("shows open-after-day, amount mismatches, voids, handovers and a void-then-remake under another barber", async () => {
    const shops = await sql("select id from public.shops where join_code = 'KB2345'");
    if (shops.length === 0) {
      console.warn("Seed data missing: run `npm run db:reset && npm run seed` first. Skipping.");
      return;
    }
    const juma = createClient(URL, ANON, { auth: { persistSession: false } });
    const { error } = await juma.auth.signInWithPassword({ email: "254711000001@phone.jasiri.app", password: "123456" });
    expect(error).toBeNull();
    const { data } = await juma.rpc("shop_flags", { p_shop: shops[0].id, p_from: "2020-01-01", p_to: "2100-01-01" });
    expect(data.open_after_day.length).toBeGreaterThanOrEqual(2);
    expect(data.mismatches.length).toBeGreaterThanOrEqual(1);
    expect(data.voids_by_person.length).toBeGreaterThanOrEqual(1);
    expect(data.handovers.length).toBeGreaterThanOrEqual(1);
    expect(data.void_recreate.length).toBeGreaterThanOrEqual(1);
    expect(data.void_recreate[0].voided_barber).not.toBe(data.void_recreate[0].new_barber);
    expect(data.open_problems).toBeGreaterThanOrEqual(1);
    // A barber (not manager) can't read flags.
    const brian = createClient(URL, ANON, { auth: { persistSession: false } });
    await brian.auth.signInWithPassword({ email: "254711000002@phone.jasiri.app", password: "123456" });
    const r = await brian.rpc("shop_flags", { p_shop: shops[0].id, p_from: "2020-01-01", p_to: "2100-01-01" });
    expect(r.error?.message).toBe("not_allowed");
  });
});
