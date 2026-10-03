"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { s } from "@/lib/strings";
import { useAct } from "@/lib/use-act";
import type { Role, ShopMembership } from "@/lib/context";
import { Badge, Button, Card, Field, Input } from "@/components/ui";
import { ErrorNote } from "@/components/error-note";
import { CopyButton } from "@/components/copy-button";

export type Member = { id: string; user_id: string; status: "pending" | "active"; roles: Role[]; name: string; is_barber: boolean };
const ROLES: Role[] = ["barber", "service_staff", "cashier", "manager"];

function RolePicker({ value, onChange }: { value: Role[]; onChange: (r: Role[]) => void }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {ROLES.map((r) => (
        <label key={r} className="flex min-h-12 items-center gap-2 rounded-xl border border-line px-3">
          <input type="checkbox" className="size-5 accent-brand" checked={value.includes(r)}
                 onChange={(e) => onChange(e.target.checked ? [...value, r] : value.filter((x) => x !== r))} />
          <span className="text-sm font-semibold">{s.shop.role[r]}</span>
        </label>
      ))}
    </div>
  );
}

function MemberCard({ m, me }: { m: Member; me: string }) {
  const [roles, setRoles] = useState<Role[]>(m.status === "pending" ? (m.is_barber ? ["barber"] : []) : m.roles);
  const { run, pending, error } = useAct();
  const router = useRouter();
  const go = async (fn: string, args: Record<string, unknown>) => {
    if (await run(fn, args)) router.refresh();
  };
  const dirty = m.status === "active" && [...roles].sort().join() !== [...m.roles].sort().join();

  return (
    <Card className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-lg font-bold">{m.name}{m.user_id === me ? " (you)" : ""}</div>
        {m.status === "pending" ? <Badge tone="amber">{s.shop.requests}</Badge> : null}
      </div>
      <ErrorNote code={error} />
      <RolePicker value={roles} onChange={setRoles} />
      {m.status === "pending" ? (
        <div className="grid grid-cols-2 gap-2">
          <Button disabled={pending} onClick={() => go("decide_join", { p_membership: m.id, p_approve: true, p_roles: roles })}>{s.shop.approve}</Button>
          <Button variant="danger" disabled={pending} onClick={() => go("decide_join", { p_membership: m.id, p_approve: false, p_roles: [] })}>{s.shop.reject}</Button>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <Button disabled={pending || !dirty} onClick={() => go("set_member_roles", { p_membership: m.id, p_roles: roles })}>{s.shop.setRoles}</Button>
          <Button variant="danger" disabled={pending} onClick={() => {
            if (confirm(m.user_id === me ? s.shop.confirmLeave : s.shop.confirmEnd)) go("end_membership", { p_membership: m.id });
          }}>{m.user_id === me ? s.shop.leaveShop : s.shop.endMembership}</Button>
        </div>
      )}
    </Card>
  );
}

export function ManageShop({ shop, members, me, site }: { shop: ShopMembership; members: Member[]; me: string; site: string }) {
  const { run, pending, error } = useAct();
  const router = useRouter();
  const [name, setName] = useState(shop.name);
  const [area, setArea] = useState(shop.area);
  const invite = `${site}/shop/join?code=${shop.join_code}`;
  const requests = members.filter((m) => m.status === "pending");
  const active = members.filter((m) => m.status === "active");

  return (
    <div className="space-y-6">
      <Card className="space-y-3">
        <div className="text-sm text-muted">{s.shop.joinCodeLabel}</div>
        <div className="font-mono text-4xl font-black tracking-[0.3em]">{shop.join_code}</div>
        <div className="grid grid-cols-2 gap-2">
          <CopyButton text={invite} label={s.shop.inviteLink} />
          <Button variant="secondary" disabled={pending} onClick={async () => {
            if (await run("new_join_code", { p_shop: shop.shop_id })) router.refresh();
          }}>{s.shop.newJoinCode}</Button>
        </div>
        <ErrorNote code={error} />
      </Card>

      <section className="space-y-3">
        <h2 className="text-lg font-bold">{s.shop.requests} ({requests.length})</h2>
        {requests.map((m) => <MemberCard key={m.id} m={m} me={me} />)}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-bold">{s.shop.members} ({active.length})</h2>
        {active.map((m) => <MemberCard key={m.id} m={m} me={me} />)}
      </section>

      <Card className="space-y-3">
        <Field label={s.shop.name}><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label={s.shop.area}><Input value={area} onChange={(e) => setArea(e.target.value)} /></Field>
        <Button variant="secondary" disabled={pending} className="w-full" onClick={async () => {
          if (await run("update_shop", { p_shop: shop.shop_id, p_name: name, p_area: area })) router.refresh();
        }}>{s.app.save}</Button>
      </Card>
    </div>
  );
}
