"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { s } from "@/lib/strings";
import { read } from "@/lib/action";
import { useAct } from "@/lib/use-act";
import { normalizePhone } from "@/lib/phone";
import { Button, Card, Field, Input, Notice } from "@/components/ui";
import { ErrorNote } from "@/components/error-note";

export type Preselected = { bookingId: string; firstName: string; services?: string[] };
type Client = { id: string; first_name: string; phone: string; visits: number; due: boolean };
type Who =
  | { kind: "returning"; client: Client }
  | { kind: "new"; firstName: string; phone: string }
  | { kind: "anonymous" }
  | { kind: "booking"; bookingId: string; firstName: string };

export function NewCode({ shopId, barberName, preselected, services }: {
  shopId: string; barberName: string; preselected: Preselected | null; services: { name: string; price: number }[];
}) {
  const [who, setWho] = useState<Who | null>(preselected ? { kind: "booking", ...preselected } : null);
  const [mode, setMode] = useState<"pick" | "search" | "new">("pick");
  const initialPicked = (preselected?.services ?? []).filter((n) => services.some((x) => x.name === n));
  const [picked, setPicked] = useState<string[]>(initialPicked);
  const sumOf = (names: string[]) => services.filter((x) => names.includes(x.name)).reduce((a, x) => a + x.price, 0);
  const [amount, setAmount] = useState(initialPicked.length ? String(sumOf(initialPicked)) : "");
  const toggle = (n: string) => {
    const next = picked.includes(n) ? picked.filter((x) => x !== n) : [...picked, n];
    setPicked(next);
    setAmount(next.length ? String(sumOf(next)) : "");
  };
  const { run, pending, error } = useAct();
  const router = useRouter();

  async function create() {
    const args: Record<string, unknown> = { p_shop: shopId, p_amount: Number(amount) };
    if (who?.kind === "returning") args.p_client = who.client.id;
    if (who?.kind === "new") Object.assign(args, { p_new_first_name: who.firstName, p_new_phone: who.phone, p_consent: true });
    if (who?.kind === "anonymous") args.p_anonymous = true;
    if (who?.kind === "booking") args.p_booking = who.bookingId;
    const r = await run<{ id: string }>("create_code", args);
    if (r) router.replace(`/code/${r.id}`);
  }

  if (!who) {
    if (mode === "search") return <ClientSearch onPick={(c) => setWho({ kind: "returning", client: c })} onBack={() => setMode("pick")} />;
    if (mode === "new") return <NewClientForm shopId={shopId} barberName={barberName}
      onDone={(firstName, phone) => setWho({ kind: "new", firstName, phone })}
      onMine={(c) => setWho({ kind: "returning", client: c })} onBack={() => setMode("pick")} />;
    return (
      <div className="space-y-3">
        <h2 className="text-lg font-bold">{s.code.whoIsClient}</h2>
        <Button className="min-h-16 w-full text-lg" onClick={() => setMode("search")}>{s.code.returning}</Button>
        <Button className="min-h-16 w-full text-lg" variant="secondary" onClick={() => setMode("new")}>{s.code.newClient}</Button>
        <Button className="min-h-16 w-full text-lg" variant="secondary" onClick={() => setWho({ kind: "anonymous" })}>{s.code.noDetails}</Button>
        <p className="text-sm text-muted">{s.code.noDetailsHint}</p>
      </div>
    );
  }

  const label = who.kind === "returning" ? who.client.first_name
    : who.kind === "new" ? who.firstName
    : who.kind === "booking" ? `${who.firstName} · ${s.code.fromBooking}` : s.code.noDetails;

  return (
    <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); create(); }}>
      <Card className="flex items-center justify-between">
        <div className="text-xl font-bold">{label}</div>
        {who.kind !== "booking" ? <button type="button" className="min-h-12 px-2 font-semibold text-brand" onClick={() => { setWho(null); setMode("pick"); }}>{s.app.cancel}</button> : null}
      </Card>
      <ErrorNote code={error} />
      {services.length ? (
        <div>
          <div className="mb-2 text-sm font-semibold text-muted">{s.services.tapToAdd}</div>
          <div className="flex flex-wrap gap-2">
            {services.map((x) => (
              <button type="button" key={x.name} onClick={() => toggle(x.name)} aria-pressed={picked.includes(x.name)}
                className={`min-h-12 rounded-2xl border px-3 font-semibold ${picked.includes(x.name) ? "border-brand bg-brand/15" : "border-line bg-surface-2 text-muted"}`}>
                {x.name} <span className="tabular-nums">{x.price}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
      <Field label={s.code.amountCharged}>
        <Input value={amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, ""))} inputMode="numeric"
               required autoFocus className="text-3xl font-bold tabular-nums" placeholder="300" />
      </Field>
      <Button disabled={pending || amount === ""} className="min-h-16 w-full text-xl">{s.code.makeCode}</Button>
    </form>
  );
}

function ClientSearch({ onPick, onBack }: { onPick: (c: Client) => void; onBack: () => void }) {
  const [q, setQ] = useState("");
  const [list, setList] = useState<Client[] | null>(null);
  useEffect(() => {
    const t = setTimeout(() => {
      read<Client[]>("my_client_book", { p_search: q || null }).then((r) => setList(r.slice(0, 30))).catch(() => setList([]));
    }, 250);
    return () => clearTimeout(t);
  }, [q]);
  return (
    <div className="space-y-3">
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={s.code.searchClients} autoFocus />
      {list === null ? <p className="text-muted">{s.app.loading}</p> : list.length === 0 ? <p className="text-muted">{s.code.notInBook}</p> : null}
      {list?.map((c) => (
        <button key={c.id} onClick={() => onPick(c)}
                className="flex min-h-14 w-full items-center justify-between rounded-xl border border-line bg-surface px-4 text-left">
          <span className="text-lg font-bold">{c.first_name}</span>
          <span className="text-muted tabular-nums">…{c.phone.slice(-3)}</span>
        </button>
      ))}
      <Button variant="ghost" onClick={onBack}>{s.app.back}</Button>
    </div>
  );
}

// Filled in by the client himself on the barber's phone. Phone number first: if he was
// served in this shop before (by any barber), his first name is filled in for him.
function NewClientForm({ shopId, barberName, onDone, onMine, onBack }: {
  shopId: string; barberName: string;
  onDone: (n: string, p: string) => void; onMine: (c: Client) => void; onBack: () => void;
}) {
  const [phone, setPhone] = useState("");
  const [checked, setChecked] = useState<null | "new" | "shop">(null);
  const [checking, setChecking] = useState(false);
  const [name, setName] = useState("");
  const [consent, setConsent] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function check(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    const p = normalizePhone(phone);
    if (!p) return setErr("invalid_phone");
    setChecking(true);
    try {
      const r = await read<{ status: "mine" | "shop" | "new"; client_id?: string; first_name?: string }>(
        "shop_client_lookup", { p_shop: shopId, p_phone: p });
      if (r.status === "mine") return onMine({ id: r.client_id!, first_name: r.first_name!, phone: p, visits: 0, due: false });
      setName(r.first_name ?? "");
      setChecked(r.status);
    } catch (e) {
      setErr((e as { code?: string }).code ?? "generic");
    } finally {
      setChecking(false);
    }
  }

  return (
    <div className="space-y-4">
      <p className="rounded-2xl bg-brand-soft p-3 font-semibold text-amber-100">{s.code.handPhone}</p>
      <ErrorNote code={err} />
      {checked === null ? (
        <form className="space-y-4" onSubmit={check}>
          <p className="text-sm text-muted">{s.code.phoneFirst}</p>
          <Field label={s.code.clientPhone}>
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} type="tel" inputMode="tel" required autoFocus placeholder="0712 345 678" />
          </Field>
          <Button className="w-full" disabled={checking}>{checking ? s.code.checking : s.booking.next}</Button>
        </form>
      ) : (
        <form className="space-y-4" onSubmit={(e) => {
          e.preventDefault();
          if (!consent) return setErr("consent_required");
          if (!name.trim()) return setErr("name_required");
          onDone(name.trim(), normalizePhone(phone)!);
        }}>
          {checked === "shop" ? <Notice tone="ok">{s.code.servedBefore(name)}</Notice> : null}
          <Field label={s.code.clientFirstName}><Input value={name} onChange={(e) => setName(e.target.value)} required autoComplete="given-name" /></Field>
          <label className="flex items-start gap-3 rounded-2xl border border-line bg-surface-2 p-3">
            <input type="checkbox" className="mt-1 size-6 shrink-0 accent-brand" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
            <span className="text-base">{s.code.consent(barberName)}</span>
          </label>
          <Button className="w-full">{s.booking.next}</Button>
        </form>
      )}
      <Button type="button" variant="ghost" onClick={onBack}>{s.app.back}</Button>
    </div>
  );
}
