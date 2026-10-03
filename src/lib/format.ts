const TZ = "Africa/Nairobi";

export function kes(n: number | null | undefined): string {
  return `KES ${(n ?? 0).toLocaleString("en-KE")}`;
}

export function time(iso: string | Date): string {
  return new Intl.DateTimeFormat("en-KE", {
    timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(new Date(iso));
}

export function dayLabel(iso: string | Date): string {
  return new Intl.DateTimeFormat("en-KE", {
    timeZone: TZ, weekday: "short", day: "numeric", month: "short",
  }).format(new Date(iso));
}

export function dateTime(iso: string | Date): string {
  return `${dayLabel(iso)} ${time(iso)}`;
}

// Today's date in Nairobi as YYYY-MM-DD. Days reset at midnight Nairobi time.
export function nairobiToday(offsetDays = 0): string {
  const d = new Date(Date.now() + offsetDays * 86400000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(d);
}

export function nairobiDate(iso: string | Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date(iso));
}

export function addDays(ymd: string, n: number): string {
  const d = new Date(ymd + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// Monday of the week containing ymd.
export function weekStart(ymd: string): string {
  const d = new Date(ymd + "T12:00:00Z");
  const dow = (d.getUTCDay() + 6) % 7;
  return addDays(ymd, -dow);
}

export function monthStart(ymd: string): string {
  return ymd.slice(0, 8) + "01";
}

// Wall-clock time in Nairobi (no DST, UTC+3) → ISO instant.
export function nairobiToIso(ymd: string, hhmm: string): string {
  return new Date(`${ymd}T${hhmm}:00+03:00`).toISOString();
}
