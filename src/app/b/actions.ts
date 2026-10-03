"use server";
import { serviceClient } from "@/lib/supabase/server";
import { clientIp, rateLimit } from "@/lib/ip";
import { normalizePhone } from "@/lib/phone";

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

async function limited(keys: [string, number, number][]): Promise<boolean> {
  for (const [k, n, w] of keys) if (!(await rateLimit(k, n, w))) return true;
  return false;
}

export async function checkPhone(handle: string, phone: string): Promise<Result<{ known: boolean }>> {
  const e164 = normalizePhone(phone);
  if (!e164) return { ok: false, error: "invalid_phone" };
  const ip = await clientIp();
  if (await limited([[`book-check-ip:${ip}`, 20, 600]])) return { ok: false, error: "rate_limited" };
  const { data, error } = await serviceClient().rpc("public_phone_known", { p_handle: handle, p_phone: e164 });
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: { known: data === true } };
}

export type Booked = { slot_start: string; barber_name: string; masked_phone: string; cancel_token: string };

export async function book(input: {
  requestId: string; handle: string; slotStart: string; phone: string; firstName?: string; consent?: boolean;
}): Promise<Result<Booked>> {
  const e164 = normalizePhone(input.phone);
  if (!e164) return { ok: false, error: "invalid_phone" };
  const ip = await clientIp();
  if (await limited([[`book-ip:${ip}`, 10, 600], [`book-phone:${e164}`, 5, 86400]])) return { ok: false, error: "rate_limited" };
  const { data, error } = await serviceClient().rpc("public_book", {
    p_request: input.requestId, p_handle: input.handle, p_slot_start: input.slotStart, p_phone: e164,
    p_first_name: input.firstName ?? null, p_consent: input.consent ?? false,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: data as Booked };
}

export async function cancelBooking(token: string): Promise<Result<{ status: string }>> {
  const ip = await clientIp();
  if (await limited([[`book-cancel-ip:${ip}`, 20, 600]])) return { ok: false, error: "rate_limited" };
  const { data, error } = await serviceClient().rpc("public_cancel", { p_token: token });
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: data as { status: string } };
}
