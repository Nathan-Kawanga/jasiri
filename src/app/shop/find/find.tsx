"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { s } from "@/lib/strings";
import { read } from "@/lib/action";
import { useAct } from "@/lib/use-act";
import { Button, Card, Field, Input, LinkButton, Notice } from "@/components/ui";
import { ErrorNote } from "@/components/error-note";
import { Icon } from "@/components/icons";
import { selectShop } from "@/app/shop-actions";

type Shop = { id: string; name: string; area: string; members: number; mine: boolean };
type Role = "barber" | "service_staff" | "cashier" | "manager";

export function FindShop({ isBarber, defaultRole }: { isBarber: boolean; defaultRole: string | null }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Shop[] | null>(null);
  const [picked, setPicked] = useState<Shop | null>(null);
  const [adding, setAdding] = useState(false);
  const [area, setArea] = useState("");
  const [role, setRole] = useState<Role | "">((defaultRole as Role) ?? "");
  const [sent, setSent] = useState<"staff" | "owner" | null>(null);
  const { run, pending, error } = useAct();
  const router = useRouter();

  const roles: { id: Role; label: string }[] = [
    ...(isBarber ? [{ id: "barber" as Role, label: s.shop.role.barber }] : []),
    { id: "service_staff", label: s.shop.role.service_staff },
    { id: "cashier", label: s.shop.role.cashier },
    { id: "manager", label: s.shop.roleOwner },
  ];

  useEffect(() => {
    if (q.trim().length < 2) return;
    const t = setTimeout(() => {
      read<Shop[]>("search_shops", { p_query: q }).then(setResults).catch(() => setResults([]));
    }, 250);
    return () => clearTimeout(t);
  }, [q]);
  const shown = q.trim().length < 2 ? null : results;

  if (sent) {
    return (
      <div className="space-y-4">
        <Notice tone="ok">{sent === "owner" ? s.shop.askSentOwner : s.shop.askSent}</Notice>
        <LinkButton href="/" className="w-full">{s.app.home}</LinkButton>
      </div>
    );
  }

  if (picked) {
    return (
      <div className="space-y-4">
        <Card>
          <div className="font-display text-2xl font-bold">{picked.name}</div>
          <div className="text-muted">{picked.area} · {s.shop.staffCount(picked.members)}</div>
        </Card>
        <ErrorNote code={error} />
        <fieldset className="space-y-2">
          <legend className="mb-1.5 text-sm font-semibold text-muted">{s.shop.askAs}</legend>
          <div className="grid grid-cols-2 gap-2">
            {roles.map((r) => (
              <button key={r.id} type="button" onClick={() => setRole(r.id)} aria-pressed={role === r.id}
                className={`min-h-12 rounded-2xl border px-3 text-sm font-semibold ${role === r.id ? "border-brand bg-brand/10 text-ink" : "border-line bg-surface-2 text-muted"}`}>
                {r.label}
              </button>
            ))}
          </div>
        </fieldset>
        <Button className="w-full" disabled={pending || !role} onClick={async () => {
          if (await run("request_join_shop", { p_shop: picked.id, p_role: role })) setSent(role === "manager" ? "owner" : "staff");
        }}>{s.shop.askToJoinShop}</Button>
        <Button variant="ghost" className="w-full" onClick={() => setPicked(null)}>{s.app.back}</Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Field label={s.shop.findLabel} hint={s.shop.findHint}>
        <Input value={q} onChange={(e) => { setQ(e.target.value); setAdding(false); }} autoFocus placeholder="e.g. Kinyozi Bora" />
      </Field>

      {shown?.map((r) => (
        <button key={r.id} disabled={r.mine} onClick={() => setPicked(r)}
          className="flex w-full items-center gap-3 rounded-3xl border border-line bg-surface p-4 text-left hover:border-brand/40 disabled:opacity-60">
          <span className="inline-flex size-11 shrink-0 items-center justify-center rounded-2xl bg-brand/10 text-brand"><Icon name="store" /></span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-lg font-bold">{r.name}</span>
            <span className="block text-sm text-muted">{r.area} · {s.shop.staffCount(r.members)}</span>
          </span>
          {r.mine ? <span className="text-sm font-semibold text-brand">{s.shop.youreIn}</span> : <Icon name="arrowLeft" className="rotate-180 text-muted" />}
        </button>
      ))}

      {shown !== null && !adding ? (
        <button onClick={() => setAdding(true)} className="flex min-h-14 w-full items-center justify-center gap-2 rounded-3xl border border-dashed border-line font-semibold text-brand">
          <Icon name="plus" size={18} />{s.shop.notListed(q.trim())}
        </button>
      ) : null}

      {adding ? (
        <Card className="space-y-3">
          <div className="text-lg font-bold">{s.shop.addShopTitle}</div>
          <p className="text-sm text-muted">{s.shop.addShopHint}</p>
          <ErrorNote code={error} />
          <Field label={s.shop.name}><Input value={q} onChange={(e) => setQ(e.target.value)} required minLength={2} /></Field>
          <Field label={s.shop.area}><Input value={area} onChange={(e) => setArea(e.target.value)} required minLength={2} placeholder="e.g. Kahawa West" /></Field>
          <Button className="w-full" disabled={pending || q.trim().length < 2 || area.trim().length < 2} onClick={async () => {
            const r = await run<{ shop_id: string }>("create_shop", { p_name: q, p_area: area });
            if (r) { await selectShop(r.shop_id); router.push("/"); router.refresh(); }
          }}>{s.shop.create}</Button>
        </Card>
      ) : null}

      <div className="flex items-center justify-between pt-2 text-sm">
        <Link href="/shop/join" className="font-semibold text-brand">{s.shop.haveCode}</Link>
        <Link href="/" className="text-muted">{s.shop.skipForNow}</Link>
      </div>
    </div>
  );
}
