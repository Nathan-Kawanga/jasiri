"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { s } from "@/lib/strings";
import { dateTime, nairobiToIso, nairobiToday, addDays } from "@/lib/format";
import { useAct } from "@/lib/use-act";
import { Button, Card, Field, Input, Notice, inputClass } from "@/components/ui";
import { ErrorNote } from "@/components/error-note";

export type Rule = { weekday: number; start_time: string; end_time: string };
export type Block = { id: string; starts_at: string; ends_at: string; kind: "off" | "busy"; note: string | null };
const ORDER = [1, 2, 3, 4, 5, 6, 0];

export function Availability({ rules: initial, blocks, slotMinutes }: { rules: Rule[]; blocks: Block[]; slotMinutes: number }) {
  const [rules, setRules] = useState<Rule[]>(initial.map((r) => ({ ...r, start_time: r.start_time.slice(0, 5), end_time: r.end_time.slice(0, 5) })));
  const [slot, setSlot] = useState(slotMinutes);
  const [saved, setSaved] = useState(false);
  const { run, pending, error } = useAct();
  const router = useRouter();

  const setRule = (i: number, patch: Partial<Rule>) => setRules(rules.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  async function save() {
    setSaved(false);
    if (await run("set_availability", { p_rules: rules, p_slot_minutes: slot })) { setSaved(true); router.refresh(); }
  }

  return (
    <div className="space-y-5">
      <Notice>{s.booking.availabilityHint}</Notice>
      <ErrorNote code={error} />
      {saved ? <Notice tone="ok">{s.app.saved}</Notice> : null}
      <Field label={s.booking.slotLength}>
        <select className={inputClass} value={slot} onChange={(e) => setSlot(Number(e.target.value))}>
          {[15, 20, 30, 45, 60, 90, 120].map((m) => <option key={m} value={m}>{m} {s.booking.minutes}</option>)}
        </select>
      </Field>
      {ORDER.map((wd) => (
        <Card key={wd} className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-lg font-bold">{s.booking.weekdays[wd]}</span>
            <Button variant="ghost" onClick={() => setRules([...rules, { weekday: wd, start_time: "09:00", end_time: "12:00" }])}>+ {s.booking.addRange}</Button>
          </div>
          {rules.map((r, i) => r.weekday !== wd ? null : (
            <div key={i} className="flex items-center gap-2">
              <Input type="time" step={900} value={r.start_time} onChange={(e) => setRule(i, { start_time: e.target.value })} aria-label={s.booking.from} />
              <span>–</span>
              <Input type="time" step={900} value={r.end_time} onChange={(e) => setRule(i, { end_time: e.target.value })} aria-label={s.booking.to} />
              <button className="min-h-12 min-w-12 text-2xl text-red-400" onClick={() => setRules(rules.filter((_, j) => j !== i))} aria-label={s.queue.remove}>×</button>
            </div>
          ))}
        </Card>
      ))}
      <Button disabled={pending} className="w-full" onClick={save}>{s.app.save}</Button>
      <Blocks blocks={blocks} />
    </div>
  );
}

function Blocks({ blocks }: { blocks: Block[] }) {
  const [date, setDate] = useState(addDays(nairobiToday(), 1));
  const [kind, setKind] = useState<"off" | "busy">("off");
  const [from, setFrom] = useState("12:00");
  const [to, setTo] = useState("14:00");
  const [note, setNote] = useState("");
  const { run, pending, error } = useAct();
  const router = useRouter();

  async function add() {
    const starts = kind === "off" ? nairobiToIso(date, "00:00") : nairobiToIso(date, from);
    const ends = kind === "off" ? nairobiToIso(addDays(date, 1), "00:00") : nairobiToIso(date, to);
    if (await run("add_block", { p_starts: starts, p_ends: ends, p_kind: kind, p_note: note || null })) router.refresh();
  }

  return (
    <section className="space-y-3">
      <h2 className="text-lg font-bold">{s.booking.blocks}</h2>
      <ErrorNote code={error} />
      {blocks.map((b) => (
        <Card key={b.id} className="flex items-center justify-between gap-2">
          <div>
            <div className="font-semibold">{b.kind === "off" ? s.booking.offDay : s.booking.busy}{b.note ? ` · ${b.note}` : ""}</div>
            <div className="text-sm text-muted">{dateTime(b.starts_at)} → {dateTime(b.ends_at)}</div>
          </div>
          <Button variant="danger" disabled={pending} onClick={async () => { if (await run("remove_block", { p_block: b.id })) router.refresh(); }}>{s.queue.remove}</Button>
        </Card>
      ))}
      <Card className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <Button variant={kind === "off" ? "primary" : "secondary"} onClick={() => setKind("off")}>{s.booking.offDay}</Button>
          <Button variant={kind === "busy" ? "primary" : "secondary"} onClick={() => setKind("busy")}>{s.booking.busy}</Button>
        </div>
        <Field label={s.booking.date}><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        {kind === "busy" ? (
          <div className="grid grid-cols-2 gap-2">
            <Field label={s.booking.from}><Input type="time" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
            <Field label={s.booking.to}><Input type="time" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
          </div>
        ) : null}
        <Field label={s.cashier.voidNote}><Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={80} /></Field>
        <Button variant="secondary" disabled={pending} className="w-full" onClick={add}>{s.booking.addBlock}</Button>
      </Card>
    </section>
  );
}
