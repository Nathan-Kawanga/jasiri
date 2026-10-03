"use client";
import { useState } from "react";
import { s } from "@/lib/strings";
import { dayLabel } from "@/lib/format";
import { read } from "@/lib/action";
import { useAct } from "@/lib/use-act";
import { normalizePhone } from "@/lib/phone";
import { Button, Card, Field, Input, Empty } from "@/components/ui";
import { ErrorNote } from "@/components/error-note";

type Found = { id: string; first_name: string; barber_name: string; created_at: string };

export function ClientDelete() {
  const [phone, setPhone] = useState("");
  const [found, setFound] = useState<Found[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const { run, pending, error } = useAct();
  async function find(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!normalizePhone(phone)) return setErr("invalid_phone");
    setFound(await read<Found[]>("admin_find_clients", { p_phone: phone }));
  }
  return (
    <div className="space-y-4">
      <form onSubmit={find} className="space-y-3">
        <ErrorNote code={err ?? error} />
        <Field label={s.admin.findByPhone}><Input value={phone} onChange={(e) => setPhone(e.target.value)} type="tel" /></Field>
        <Button variant="secondary" className="w-full">{s.app.search}</Button>
      </form>
      {found?.length === 0 ? <Empty>{s.app.none}</Empty> : null}
      {found?.map((c) => (
        <Card key={c.id} className="flex items-center justify-between gap-2">
          <div><b>{c.first_name}</b><div className="text-sm text-muted">{c.barber_name} · {dayLabel(c.created_at)}</div></div>
          <Button variant="danger" disabled={pending} onClick={async () => {
            if (confirm(s.admin.confirmDelete) && (await run("admin_delete_client", { p_client: c.id }))) setFound(found.filter((x) => x.id !== c.id));
          }}>{s.admin.delete}</Button>
        </Card>
      ))}
    </div>
  );
}
