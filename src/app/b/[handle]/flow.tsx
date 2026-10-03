"use client";
import { useMemo, useRef, useState } from "react";
import { s, errorText } from "@/lib/strings";
import { time, dayLabel, nairobiDate } from "@/lib/format";
import { uuid } from "@/lib/ids";
import { Button, Card, Field, Input, Notice } from "@/components/ui";
import { checkPhone, book, type Booked } from "../actions";

export type PublicBarber = {
  name: string; handle: string; about: string | null; slot_minutes: number;
  shop: { name: string; area: string } | null; slots: string[];
  photo_path: string | null; photos: { path: string; caption: string | null }[];
};

export function BookingFlow({ barber }: { barber: PublicBarber }) {
  const [slots, setSlots] = useState(barber.slots);
  const [slot, setSlot] = useState<string | null>(null);
  const [phone, setPhone] = useState("");
  const [needName, setNeedName] = useState<boolean | null>(null);
  const [name, setName] = useState("");
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState<Booked | null>(null);
  const [dayIdx, setDayIdx] = useState(0);
  const requestId = useRef(uuid());

  const byDay = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const t of slots) {
      const d = nairobiDate(t);
      m.set(d, [...(m.get(d) ?? []), t]);
    }
    return [...m.entries()];
  }, [slots]);

  if (done) {
    const cancelUrl = `/b/c/${done.cancel_token}`;
    return (
      <Card className="space-y-3 text-center">
        <div className="mx-auto inline-flex size-20 items-center justify-center rounded-full gold-grad text-4xl font-black text-black shine">✓</div>
        <div className="text-2xl font-black">{s.booking.booked}</div>
        <div className="text-xl">{dayLabel(done.slot_start)} · <b>{time(done.slot_start)}</b></div>
        <div className="text-muted tabular-nums">{done.masked_phone}</div>
        <Notice>{s.booking.keepLink}</Notice>
        <a href={cancelUrl} className="block min-h-12 py-3 font-semibold text-red-400">{s.booking.cancelLink}</a>
      </Card>
    );
  }

  async function next(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    const r = await checkPhone(barber.handle, phone);
    setPending(false);
    if (!r.ok) return setError(r.error);
    if (r.data.known) await submit(); else setNeedName(true);
  }

  async function submit() {
    setError(null);
    setPending(true);
    const r = await book({ requestId: requestId.current, handle: barber.handle, slotStart: slot!, phone, firstName: name, consent });
    setPending(false);
    if (r.ok) return setDone(r.data);
    requestId.current = uuid();
    if (r.error === "slot_taken" || r.error === "slot_not_bookable") {
      setSlots(slots.filter((t) => t !== slot));
      setSlot(null);
      setNeedName(null);
    }
    setError(r.error);
  }

  return (
    <div className="space-y-4">
      {error ? <Notice tone="error">{error === "slot_taken" ? s.booking.taken : errorText(error)}</Notice> : null}
      {!slot ? (
        <section className="space-y-4">
          <h2 className="text-xl font-bold">{s.booking.pickTime}</h2>
          {byDay.length === 0 ? <Notice>{s.booking.noTimes}</Notice> : null}
          {byDay.length ? (
            <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
              {byDay.map(([d, times], i) => (
                <button key={d} onClick={() => setDayIdx(i)}
                  className={`min-h-12 shrink-0 rounded-full px-4 text-sm font-semibold ${i === Math.min(dayIdx, byDay.length - 1) ? "gold-grad text-black" : "border border-line bg-surface-2"}`}>
                  {dayLabel(times[0])}
                </button>
              ))}
            </div>
          ) : null}
          {byDay.length ? (
            <div className="grid grid-cols-4 gap-2">
              {byDay[Math.min(dayIdx, byDay.length - 1)][1].map((t) => (
                <button key={t} onClick={() => setSlot(t)} className="min-h-12 rounded-2xl border border-brand/40 bg-brand/10 font-bold text-amber-200 tabular-nums active:scale-95">{time(t)}</button>
              ))}
            </div>
          ) : null}
        </section>
      ) : (
        <Card className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="text-xl font-bold">{dayLabel(slot)} · {time(slot)}</div>
            <button className="min-h-12 px-2 font-semibold text-brand" onClick={() => { setSlot(null); setNeedName(null); }}>{s.app.back}</button>
          </div>
          {needName === null ? (
            <form onSubmit={next} className="space-y-3">
              <Field label={s.booking.yourPhone}><Input value={phone} onChange={(e) => setPhone(e.target.value)} type="tel" inputMode="tel" required autoComplete="tel" placeholder="0712 345 678" /></Field>
              <Button disabled={pending} className="w-full">{s.booking.next}</Button>
            </form>
          ) : (
            <form onSubmit={(e) => { e.preventDefault(); if (!consent) return setError("consent_required"); submit(); }} className="space-y-3">
              <Field label={s.booking.yourFirstName}><Input value={name} onChange={(e) => setName(e.target.value)} required autoComplete="given-name" /></Field>
              <label className="flex items-start gap-3">
                <input type="checkbox" className="mt-1 size-6 shrink-0 accent-brand" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
                <span>{s.code.consent(barber.name)}</span>
              </label>
              <Button disabled={pending} className="w-full">{s.booking.book}</Button>
            </form>
          )}
        </Card>
      )}
    </div>
  );
}
