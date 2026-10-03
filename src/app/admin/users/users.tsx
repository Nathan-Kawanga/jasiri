"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { s, errorText } from "@/lib/strings";
import { dayLabel } from "@/lib/format";
import { displayPhone } from "@/lib/phone";
import { useAct } from "@/lib/use-act";
import { Badge, Button, Card, Input, Notice } from "@/components/ui";
import { ErrorNote } from "@/components/error-note";
import { adminResetPin } from "../actions";

export type AdminUser = {
  id: string; full_name: string; phone: string | null; email: string | null; handle: string | null; is_barber: boolean;
  is_platform_admin: boolean; suspended: boolean; trial_ends_at: string; paid_until: string | null; created_at: string; shops: string[] | null;
};

function UserCard({ u, me }: { u: AdminUser; me: string }) {
  const [paid, setPaid] = useState(u.paid_until ?? "");
  const [pin, setPin] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [pinErr, setPinErr] = useState<string | null>(null);
  const { run, pending, error } = useAct();
  const router = useRouter();
  return (
    <Card className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <b className="text-lg">{u.full_name}</b>
        {u.is_barber ? <Badge tone="blue">{s.shop.role.barber}</Badge> : null}
        {u.is_platform_admin ? <Badge>admin</Badge> : null}
        {u.suspended ? <Badge tone="red">{s.admin.suspend}</Badge> : null}
      </div>
      <div className="text-sm text-muted">{u.phone ? displayPhone(u.phone) : u.email}{u.handle ? ` · /b/${u.handle}` : ""} · {(u.shops ?? []).join(", ")}</div>
      {u.is_barber ? <div className="text-sm">{s.home.trialEnds}: {dayLabel(u.trial_ends_at)}</div> : null}
      <ErrorNote code={error ?? pinErr} />
      {msg ? <Notice tone="ok">{msg}</Notice> : null}
      {u.is_barber ? (
        <div className="flex items-end gap-2">
          <label className="flex-1"><span className="text-sm font-semibold">{s.admin.paidUntil}</span>
            <Input type="date" value={paid} onChange={(e) => setPaid(e.target.value)} /></label>
          <Button variant="secondary" disabled={pending} onClick={async () => {
            if (await run("admin_set_paid_until", { p_user: u.id, p_until: paid || null })) { setMsg(s.app.saved); router.refresh(); }
          }}>{s.admin.setPaid}</Button>
        </div>
      ) : null}
      <div className="flex items-end gap-2">
        <Input value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" placeholder={s.admin.newPinFor} />
        <Button variant="secondary" disabled={pin.length !== 6} onClick={async () => {
          setPinErr(null);
          const r = await adminResetPin(u.id, pin);
          if (r.ok) { setMsg(s.admin.pinReset); setPin(""); } else setPinErr(r.error ?? "generic");
        }}>{s.admin.resetPin}</Button>
      </div>
      {u.id !== me ? (
        <Button variant={u.suspended ? "secondary" : "danger"} className="w-full" disabled={pending} onClick={async () => {
          if (await run("admin_set_suspended", { p_user: u.id, p_suspended: !u.suspended })) router.refresh();
        }}>{u.suspended ? s.admin.unsuspend : s.admin.suspend}</Button>
      ) : null}
      {pinErr ? <span className="sr-only">{errorText(pinErr)}</span> : null}
    </Card>
  );
}

export function UserList({ users, me }: { users: AdminUser[]; me: string }) {
  return <div className="space-y-3">{users.map((u) => <UserCard key={u.id} u={u} me={me} />)}</div>;
}
