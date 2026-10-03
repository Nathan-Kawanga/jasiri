"use client";
import { useMemo, useState } from "react";
import { s } from "@/lib/strings";
import { kes, dayLabel } from "@/lib/format";
import { displayPhone, normalizePhone } from "@/lib/phone";
import { read } from "@/lib/action";
import { useAct } from "@/lib/use-act";
import { Badge, Button, Card, Field, Input, Empty } from "@/components/ui";
import { ErrorNote } from "@/components/error-note";

export type BookClient = {
  id: string; first_name: string; phone: string; visits: number; last_visit: string | null;
  total_spent: number; avg_gap_days: number | null; days_since: number | null; due: boolean;
};

export function ClientBook({ initial, barberName }: { initial: BookClient[]; barberName: string }) {
  const [all, setAll] = useState(initial);
  const [q, setQ] = useState("");
  const [adding, setAdding] = useState(false);
  const list = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return all;
    return all.filter((c) => c.first_name.toLowerCase().includes(t) || c.phone.endsWith(t) || c.phone.includes(t));
  }, [all, q]);
  const reload = async () => setAll(await read<BookClient[]>("my_client_book", { p_search: null }));
  const due = all.filter((c) => c.due).length;

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={s.code.searchClients} />
        <Button variant="secondary" onClick={() => setAdding(!adding)}>+</Button>
      </div>
      {adding ? <AddClient barberName={barberName} onDone={async () => { setAdding(false); await reload(); }} /> : null}
      <p className="text-muted">{all.length} · {s.clients.due}: <b>{due}</b></p>
      {list.length === 0 ? <Empty>{s.app.none}</Empty> : null}
      {list.map((c) => (
        <Card key={c.id} className="space-y-1">
          <div className="flex items-center justify-between gap-2">
            <span className="text-lg font-bold">{c.first_name}</span>
            {c.due ? <Badge tone="amber">{s.clients.due}</Badge> : null}
          </div>
          <div className="flex items-center justify-between">
            <a href={`tel:${c.phone}`} className="min-h-12 py-3 font-semibold text-brand tabular-nums">{displayPhone(c.phone)}</a>
            <span className="text-sm text-muted">{c.visits} {s.clients.visits} · {kes(c.total_spent)}</span>
          </div>
          <div className="text-sm text-muted">
            {c.last_visit ? `${s.clients.lastVisit}: ${dayLabel(c.last_visit)} (${s.clients.daysAgo(c.days_since ?? 0)})` : s.clients.neverVisited}
            {c.avg_gap_days ? ` · ${s.clients.avgGap(Math.round(c.avg_gap_days))}` : ""}
          </div>
        </Card>
      ))}
    </div>
  );
}

function AddClient({ barberName, onDone }: { barberName: string; onDone: () => void }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [consent, setConsent] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const { run, pending, error } = useAct();
  return (
    <Card>
      <form className="space-y-3" onSubmit={async (e) => {
        e.preventDefault();
        setErr(null);
        if (!normalizePhone(phone)) return setErr("invalid_phone");
        if (await run("add_client", { p_first_name: name, p_phone: phone, p_consent: consent })) onDone();
      }}>
        <div className="font-bold">{s.clients.add}</div>
        <ErrorNote code={err ?? error} />
        <Field label={s.code.clientFirstName}><Input value={name} onChange={(e) => setName(e.target.value)} required /></Field>
        <Field label={s.code.clientPhone}><Input value={phone} onChange={(e) => setPhone(e.target.value)} type="tel" required /></Field>
        <label className="flex items-start gap-3">
          <input type="checkbox" className="mt-1 size-6 accent-brand" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
          <span>{s.code.consent(barberName)}</span>
        </label>
        <Button disabled={pending} className="w-full">{s.app.save}</Button>
      </form>
    </Card>
  );
}
