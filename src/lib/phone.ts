// Mirrors public.normalize_phone in the database (which is the authority).
// Accepts 07XXXXXXXX, 01XXXXXXXX, 2547…, +2547…, 2541…, +2541…; returns E.164.
export function normalizePhone(input: string): string | null {
  const d = input.replace(/[\s-]/g, "");
  if (/^\+254[17]\d{8}$/.test(d)) return d;
  if (/^254[17]\d{8}$/.test(d)) return "+" + d;
  if (/^0[17]\d{8}$/.test(d)) return "+254" + d.slice(1);
  return null;
}

// +254712345678 → 0712 345 678
export function displayPhone(e164: string | null | undefined): string {
  if (!e164) return "";
  const local = "0" + e164.slice(4);
  return `${local.slice(0, 4)} ${local.slice(4, 7)} ${local.slice(7)}`;
}

// Phone accounts sign in through an internal email address; people never see it.
export function phoneLoginEmail(e164: string): string {
  return `${e164.slice(1)}@phone.jasiri.app`;
}

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
