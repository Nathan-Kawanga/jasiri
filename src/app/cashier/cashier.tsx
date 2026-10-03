"use client";
import { useState } from "react";
import { s } from "@/lib/strings";
import { kes, time, nairobiToday, dayLabel } from "@/lib/format";
import { useAct } from "@/lib/use-act";
import { useLive } from "@/lib/use-live";
import { Badge, Button, Card, Field, Input, Notice, Empty, inputClass } from "@/components/ui";
import { ErrorNote } from "@/components/error-note";

export type CCode = {
  id: string; display_code: string; status: "open" | "paid" | "voided"; service_status: string;
  client_first_name: string | null; barber_name: string | null; staff_name: string | null;
  barber_amount: number; lines_total: number; expected_total: number; amount_paid: number | null;
  confirmed_at: string; created_day: string; paid_at: string | null; void_reason: string | null;
};

export function Cashier({ shopId, initial }: { shopId: string; initial: CCode[] }) {
  const { data, reload } = useLive<CCode[]>("cashier_codes", { p_shop: shopId }, shopId, initial);
  const [q, setQ] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const match = (c: CCode) => !q || c.display_code.includes(q.toUpperCase()) || (c.client_first_name ?? "").toLowerCase().includes(q.toLowerCase());
  const open = data.filter((c) => c.status === "open" && match(c));
  const paid = data.filter((c) => c.status === "paid" && match(c));
  const voided = data.filter((c) => c.status === "voided" && match(c));
  const current = data.find((c) => c.id === openId);
  const today = nairobiToday();

  if (current && current.status === "open") {
    return <PayPanel code={current} onClose={() => { setOpenId(null); reload(); }} />;
  }

  return (
    <div className="space-y-5">
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={s.cashier.find} autoCapitalize="characters" />
      <section className="space-y-2">
        <h2 className="text-lg font-bold">{s.cashier.ready} ({open.length})</h2>
        {open.length === 0 ? <Empty>{s.app.none}</Empty> : null}
        {open.map((c) => (
          <button key={c.id} onClick={() => setOpenId(c.id)} className="block w-full rounded-2xl border-2 border-line bg-white p-4 text-left active:scale-[0.99]">
            <div className="flex items-center justify-between">
              <span className="font-mono text-3xl font-black tracking-widest">{c.display_code}</span>
              <span className="text-2xl font-bold tabular-nums">{kes(c.expected_total)}</span>
            </div>
            <div className="mt-1 text-lg font-semibold">{c.client_first_name ?? s.code.noDetails}</div>
            <div className="text-sm text-muted">{s.cashier.barber}: {c.barber_name ?? s.code.noBarber}</div>
            <div className="text-sm text-muted">{s.cashier.staff}: {c.staff_name ?? "—"}</div>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <Badge tone={c.service_status === "pending" || c.service_status === "in_progress" ? "amber" : "green"}>{s.code.service[c.service_status]}</Badge>
              {c.created_day !== today ? <Badge tone="red">{dayLabel(c.created_day + "T12:00:00+03:00")}</Badge> : null}
            </div>
          </button>
        ))}
      </section>
      <section className="space-y-2">
        <h2 className="text-lg font-bold">{s.cashier.paidToday} ({paid.length})</h2>
        {paid.map((c) => (
          <div key={c.id} className="flex items-center justify-between rounded-xl bg-white px-3 py-2">
            <span><b className="font-mono">{c.display_code}</b> · {c.client_first_name ?? "—"} · {time(c.paid_at!)}</span>
            <span className="tabular-nums">{kes(c.amount_paid)}{c.amount_paid !== c.expected_total ? " ⚠" : ""}</span>
          </div>
        ))}
      </section>
      {voided.length ? (
        <section className="space-y-2">
          <h2 className="text-lg font-bold">{s.cashier.voidedToday} ({voided.length})</h2>
          {voided.map((c) => (
            <div key={c.id} className="rounded-xl bg-white px-3 py-2 text-muted">
              <b className="font-mono">{c.display_code}</b> · {s.cashier.reasons[c.void_reason ?? "other"]}
            </div>
          ))}
        </section>
      ) : null}
    </div>
  );
}

function PayPanel({ code, onClose }: { code: CCode; onClose: () => void }) {
  const [amount, setAmount] = useState("");
  const [voiding, setVoiding] = useState(false);
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [done, setDone] = useState<number | null>(null);
  const { run, pending, error } = useAct();
  const n = amount === "" ? null : Number(amount);
  const atService = code.service_status === "pending" || code.service_status === "in_progress";

  if (done !== null) {
    return (
      <div className="space-y-4 text-center">
        <div className="text-6xl">✓</div>
        <div className="text-2xl font-black">{s.cashier.paid}: {kes(done)}</div>
        <div className="font-mono text-3xl">{code.display_code}</div>
        <Button className="min-h-16 w-full text-xl" onClick={onClose}>{s.app.done}</Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <button onClick={onClose} className="min-h-12 font-semibold text-brand">← {s.cashier.title}</button>
      <div className="text-center">
        <div className="font-mono text-6xl font-black tracking-[0.2em]">{code.display_code}</div>
        <div className="text-xl font-semibold">{code.client_first_name ?? "—"}</div>
      </div>
      <Card className="space-y-1 text-lg">
        <div className="flex justify-between"><span>{s.cashier.barber}: {code.barber_name ?? s.code.noBarber}</span><b className="tabular-nums">{kes(code.barber_amount)}</b></div>
        <div className="flex justify-between"><span>{s.cashier.staff}: {code.staff_name ?? "—"}</span><b className="tabular-nums">{kes(code.lines_total)}</b></div>
        <div className="flex justify-between border-t border-line pt-1"><span>{s.cashier.expected}</span><b className="tabular-nums">{kes(code.expected_total)}</b></div>
      </Card>
      {atService ? <Notice tone="warn">{s.cashier.stillAtService}</Notice> : null}
      <ErrorNote code={error} />

      {!voiding ? (
        <>
          <Field label={s.cashier.amountPaid}>
            <Input value={amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, ""))} inputMode="numeric" className="text-3xl font-bold tabular-nums" />
          </Field>
          <Button variant="secondary" className="w-full" onClick={() => setAmount(String(code.expected_total))}>{s.cashier.sameAsTotal(kes(code.expected_total))}</Button>
          {n !== null && n !== code.expected_total ? <Notice tone="warn">{s.cashier.mismatch}</Notice> : null}
          <button disabled={pending || n === null}
            onClick={async () => { if (await run("pay_code", { p_code: code.id, p_amount_paid: n })) setDone(n); }}
            className="min-h-24 w-full rounded-2xl bg-brand px-3 text-xl font-black text-white active:scale-[0.98] disabled:opacity-40">
            {n === null ? s.cashier.amountPaid : s.cashier.clientTapPaid(kes(n))}
          </button>
          <Button variant="danger" className="w-full" onClick={() => setVoiding(true)}>{s.cashier.void}</Button>
        </>
      ) : (
        <Card className="space-y-3">
          <div className="text-lg font-bold">{s.cashier.voidTitle}</div>
          <Field label={s.cashier.voidReason}>
            <select className={inputClass} value={reason} onChange={(e) => setReason(e.target.value)}>
              <option value="">—</option>
              {Object.entries(s.cashier.reasons).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Field>
          <Field label={s.cashier.voidNote}><Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} /></Field>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="secondary" onClick={() => setVoiding(false)}>{s.app.cancel}</Button>
            <Button variant="dangerSolid" disabled={pending || !reason}
              onClick={async () => { if (await run("void_code", { p_code: code.id, p_reason: reason, p_note: note || null })) onClose(); }}>{s.cashier.confirmVoid}</Button>
          </div>
        </Card>
      )}
    </div>
  );
}
