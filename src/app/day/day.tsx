"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { s } from "@/lib/strings";
import { time, nairobiToIso } from "@/lib/format";
import { displayPhone, normalizePhone } from "@/lib/phone";
import { read } from "@/lib/action";
import { useAct } from "@/lib/use-act";
import { Badge, Button, Card, Field, Input, LinkButton, Empty } from "@/components/ui";
import { ErrorNote } from "@/components/error-note";

type Booking = {
  id: string; slot_start: string; slot_end: string; status: string; source: "link" | "manual";
  client_first_name: string | null; client_phone: string | null; code_id: string | null;
  services?: { name: string; price: number }[];
};
export type DayData = { bookings: Booking[]; free_slots: { slot_start: string; slot_end: string }[] };
type Item = { kind: "booking"; at: string; b: Booking } | { kind: "free"; at: string; end: string };

export function DayView({ day, data, canCode, barberName }: { day: string; data: DayData; canCode: boolean; barberName: string }) {
  const { run, pending, error } = useAct();
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const items: Item[] = [
    ...data.bookings.map((b) => ({ kind: "booking" as const, at: b.slot_start, b })),
    ...data.free_slots.map((f) => ({ kind: "free" as const, at: f.slot_start, end: f.slot_end })),
  ].sort((a, b) => a.at.localeCompare(b.at));

  const update = async (id: string, status: string) => {
    if (await run("update_booking_status", { p_booking: id, p_status: status })) router.refresh();
  };

  return (
    <div className="space-y-3">
      <ErrorNote code={error} />
      {items.length === 0 ? <Empty>{s.app.none}</Empty> : null}
      {items.map((it) => it.kind === "free" ? (
        <div key={`f${it.at}`} className="flex items-center justify-between rounded-xl border border-dashed border-line px-3 py-2 text-muted">
          <span className="tabular-nums">{time(it.at)}–{time(it.end)}</span><span>{s.booking.walkIn}</span>
        </div>
      ) : (
        <Card key={it.b.id} className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xl font-bold tabular-nums">{time(it.b.slot_start)}</span>
            <Badge tone={it.b.status === "booked" ? "green" : it.b.status === "no_show" ? "red" : "gray"}>{s.booking.status[it.b.status]}</Badge>
          </div>
          <div className="text-lg font-semibold">{it.b.client_first_name ?? "—"}</div>
          {it.b.services?.length ? (
            <div className="flex flex-wrap gap-1.5">
              {it.b.services.map((x) => <span key={x.name} className="rounded-full bg-brand/10 px-2.5 py-0.5 text-sm text-amber-200">{x.name} · {x.price}</span>)}
            </div>
          ) : null}
          <div className="flex items-center justify-between text-sm text-muted">
            {it.b.client_phone ? <a className="font-semibold text-brand" href={`tel:${it.b.client_phone}`}>{displayPhone(it.b.client_phone)}</a> : <span />}
            <span>{it.b.source === "link" ? s.booking.sourceLink : s.booking.sourceManual}</span>
          </div>
          {it.b.status === "booked" ? (
            <div className="grid grid-cols-3 gap-2">
              {canCode ? <LinkButton href={`/code/new?booking=${it.b.id}`} className="col-span-3">{s.booking.startCode}</LinkButton> : null}
              <Button variant="secondary" disabled={pending} onClick={() => update(it.b.id, "no_show")}>{s.booking.noShow}</Button>
              <Button variant="danger" className="col-span-2" disabled={pending}
                onClick={() => { if (confirm(s.booking.cancelBooking + "?")) update(it.b.id, "cancelled"); }}>{s.booking.cancelBooking}</Button>
            </div>
          ) : null}
        </Card>
      ))}
      {adding ? <ManualBooking day={day} barberName={barberName} onDone={() => { setAdding(false); router.refresh(); }} />
        : <Button variant="secondary" className="w-full" onClick={() => setAdding(true)}>{s.booking.manual}</Button>}
    </div>
  );
}

type Client = { id: string; first_name: string; phone: string };

function ManualBooking({ day, barberName, onDone }: { day: string; barberName: string; onDone: () => void }) {
  const [date, setDate] = useState(day);
  const [at, setAt] = useState("10:00");
  const [q, setQ] = useState("");
  const [found, setFound] = useState<Client[]>([]);
  const [client, setClient] = useState<Client | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [consent, setConsent] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const { run, pending, error } = useAct();

  async function search(v: string) {
    setQ(v);
    setFound(v.length >= 2 ? (await read<Client[]>("my_client_book", { p_search: v })).slice(0, 8) : []);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    const args: Record<string, unknown> = { p_slot_start: nairobiToIso(date, at) };
    if (client) args.p_client = client.id;
    else {
      if (!normalizePhone(phone)) return setErr("invalid_phone");
      Object.assign(args, { p_new_first_name: name, p_new_phone: phone, p_consent: consent });
    }
    if (await run("manual_booking", args)) onDone();
  }

  return (
    <Card>
      <form onSubmit={save} className="space-y-3">
        <div className="font-bold">{s.booking.manual}</div>
        <p className="text-sm text-muted">{s.booking.manualHint}</p>
        <ErrorNote code={err ?? error} />
        <div className="grid grid-cols-2 gap-2">
          <Field label={s.booking.date}><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} required /></Field>
          <Field label={s.booking.time}><Input type="time" step={300} value={at} onChange={(e) => setAt(e.target.value)} required /></Field>
        </div>
        {client ? (
          <div className="flex items-center justify-between rounded-xl bg-brand-soft p-3">
            <b>{client.first_name}</b><button type="button" className="font-semibold text-brand" onClick={() => setClient(null)}>{s.app.cancel}</button>
          </div>
        ) : isNew ? (
          <>
            <Field label={s.code.clientFirstName}><Input value={name} onChange={(e) => setName(e.target.value)} required /></Field>
            <Field label={s.code.clientPhone}><Input value={phone} onChange={(e) => setPhone(e.target.value)} type="tel" required /></Field>
            <label className="flex items-start gap-3">
              <input type="checkbox" className="mt-1 size-6 accent-brand" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
              <span>{s.code.consent(barberName)}</span>
            </label>
          </>
        ) : (
          <>
            <Input value={q} onChange={(e) => search(e.target.value)} placeholder={s.code.searchClients} />
            {found.map((c) => (
              <button type="button" key={c.id} onClick={() => setClient(c)} className="flex min-h-12 w-full items-center justify-between rounded-xl border border-line bg-surface px-3">
                <b>{c.first_name}</b><span className="text-muted">…{c.phone.slice(-3)}</span>
              </button>
            ))}
            <Button type="button" variant="ghost" onClick={() => setIsNew(true)}>{s.code.newClient}</Button>
          </>
        )}
        <Button disabled={pending || (!client && !isNew)} className="w-full">{s.app.save}</Button>
      </form>
    </Card>
  );
}
