"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { s } from "@/lib/strings";
import { kes, time } from "@/lib/format";
import { useAct } from "@/lib/use-act";
import { useLive } from "@/lib/use-live";
import { Badge, Button, Card, Field, Input, Notice, Empty } from "@/components/ui";
import { ErrorNote } from "@/components/error-note";

type Line = { id: string; amount: number; note: string | null; mine: boolean };
type QCode = {
  id: string; display_code: string; service_status: "pending" | "in_progress"; client_first_name: string | null;
  barber_name: string | null; mine: boolean; assigned_at: string | null; confirmed_at: string; lines: Line[];
};
export type QueueData = {
  on_duty: boolean; codes: QCode[]; colleagues: { id: string; name: string; on_duty: boolean }[]; recent_amounts: number[];
};

export function Queue({ shopId, initial }: { shopId: string; initial: QueueData }) {
  const { data, reload } = useLive<QueueData>("service_queue", { p_shop: shopId }, shopId, initial);
  const [openId, setOpenId] = useState<string | null>(null);
  const { run, pending, error } = useAct();
  const router = useRouter();
  const mine = data.codes.filter((c) => c.mine);
  const unassigned = data.codes.filter((c) => !c.mine);
  const open = data.codes.find((c) => c.id === openId && c.mine);

  if (open) return <CodeWork code={open} data={data} onClose={() => { setOpenId(null); reload(); }} reload={reload} />;

  return (
    <div className="space-y-5">
      <ErrorNote code={error} />
      <Card className="flex items-center justify-between gap-3">
        <div>
          <div className="font-bold">{data.on_duty ? s.shop.onDuty : s.shop.offDuty}</div>
          {!data.on_duty ? <div className="text-sm text-muted">{s.queue.notOnDuty}</div> : null}
        </div>
        <Button variant={data.on_duty ? "secondary" : "primary"} disabled={pending}
          onClick={async () => { if (await run("set_on_duty", { p_shop: shopId, p_on: !data.on_duty })) reload(); }}>
          {data.on_duty ? s.shop.goOffDuty : s.shop.goOnDuty}
        </Button>
      </Card>

      <section className="space-y-2">
        <h2 className="text-lg font-bold">{s.queue.mine} ({mine.length})</h2>
        {mine.length === 0 ? <Empty>{s.queue.empty}</Empty> : null}
        {mine.map((c) => (
          <button key={c.id} onClick={() => setOpenId(c.id)} className="block w-full rounded-2xl border-2 border-brand bg-white p-4 text-left active:scale-[0.99]">
            <div className="flex items-center justify-between">
              <span className="font-mono text-3xl font-black tracking-widest">{c.display_code}</span>
              <Badge tone={c.service_status === "in_progress" ? "green" : "amber"}>{s.code.service[c.service_status]}</Badge>
            </div>
            <div className="mt-1 text-lg font-semibold">{c.client_first_name ?? "—"}</div>
            <div className="text-sm text-muted">{c.barber_name ?? s.code.noBarber} · {time(c.assigned_at ?? c.confirmed_at)}</div>
          </button>
        ))}
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-bold">{s.queue.unassigned} ({unassigned.length})</h2>
        {unassigned.map((c) => (
          <Card key={c.id} className="flex items-center justify-between gap-2">
            <div>
              <div className="font-mono text-2xl font-black tracking-widest">{c.display_code}</div>
              <div className="text-sm text-muted">{c.client_first_name ?? "—"} · {c.barber_name ?? s.code.noBarber} · {time(c.confirmed_at)}</div>
            </div>
            <Button disabled={pending} onClick={async () => { if (await run("take_code", { p_code: c.id })) { await reload(); setOpenId(c.id); } }}>{s.queue.take}</Button>
          </Card>
        ))}
      </section>

      <ServiceOnly shopId={shopId} onMade={(id) => router.push(`/code/${id}`)} />
    </div>
  );
}

function ServiceOnly({ shopId, onMade }: { shopId: string; onMade: (id: string) => void }) {
  const [show, setShow] = useState(false);
  const [name, setName] = useState("");
  const { run, pending, error } = useAct();
  if (!show) return <Button variant="secondary" className="w-full" onClick={() => setShow(true)}>{s.queue.serviceOnlyCode}</Button>;
  return (
    <Card className="space-y-3">
      <div className="font-bold">{s.queue.serviceOnlyCode}</div>
      <p className="text-sm text-muted">{s.queue.serviceOnlyHint}</p>
      <ErrorNote code={error} />
      <Field label={s.queue.firstNameOptional}><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
      <Button className="w-full" disabled={pending} onClick={async () => {
        const r = await run<{ id: string }>("create_service_code", { p_shop: shopId, p_first_name: name || null });
        if (r) onMade(r.id);
      }}>{s.code.makeCode}</Button>
    </Card>
  );
}

function CodeWork({ code, data, onClose, reload }: { code: QCode; data: QueueData; onClose: () => void; reload: () => Promise<void> }) {
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [handing, setHanding] = useState(false);
  const { run, pending, error } = useAct();
  const total = code.lines.reduce((a, l) => a + l.amount, 0);

  const go = async (fn: string, args: Record<string, unknown>, close = false) => {
    const r = await run(fn, args);
    if (r) { if (close) onClose(); else await reload(); }
    return r;
  };

  return (
    <div className="space-y-4">
      <button onClick={onClose} className="min-h-12 font-semibold text-brand">← {s.queue.title}</button>
      <div className="text-center">
        <div className="font-mono text-6xl font-black tracking-[0.2em]">{code.display_code}</div>
        <div className="text-xl font-semibold">{code.client_first_name ?? "—"}</div>
        <div className="text-muted">{code.barber_name ?? s.code.noBarber}</div>
      </div>
      <ErrorNote code={error} />

      {code.service_status === "pending" ? (
        <div>
          <button disabled={pending} onClick={() => go("service_start", { p_code: code.id })}
            className="min-h-24 w-full rounded-2xl bg-brand text-2xl font-black text-white active:scale-[0.98] disabled:opacity-60">
            {s.queue.clientConfirm}
          </button>
          <p className="mt-2 text-center text-sm text-muted">{s.queue.clientConfirmHint}</p>
        </div>
      ) : null}

      <Card className="space-y-3">
        <div className="font-bold">{s.queue.yourServices}</div>
        {code.lines.map((l) => (
          <div key={l.id} className="flex items-center justify-between gap-2">
            <span>{l.note ?? "—"} · <b>{kes(l.amount)}</b></span>
            {l.mine ? <Button variant="ghost" disabled={pending} onClick={() => go("remove_service_line", { p_line: l.id })}>{s.queue.remove}</Button> : null}
          </div>
        ))}
        {code.lines.length ? <div className="border-t border-line pt-2 text-lg font-bold">{kes(total)}</div> : null}
        <form className="space-y-2" onSubmit={async (e) => {
          e.preventDefault();
          if (await go("add_service_line", { p_code: code.id, p_amount: Number(amount), p_note: note || null })) { setAmount(""); setNote(""); }
        }}>
          <div className="text-sm font-semibold">{s.queue.addService}</div>
          {data.recent_amounts.length ? (
            <div className="flex flex-wrap gap-2">
              {data.recent_amounts.map((a) => (
                <button type="button" key={a} onClick={() => setAmount(String(a))}
                  className={`min-h-12 rounded-xl border-2 px-3 font-semibold ${amount === String(a) ? "border-brand bg-brand-soft" : "border-line bg-white"}`}>{a}</button>
              ))}
            </div>
          ) : null}
          <Input value={amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, ""))} inputMode="numeric" placeholder={s.queue.amount} className="text-2xl font-bold" required />
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder={s.queue.whatService} maxLength={60} />
          <Button variant="secondary" disabled={pending || !amount} className="w-full">{s.queue.add}</Button>
        </form>
      </Card>

      <Button className="min-h-16 w-full text-lg" disabled={pending || code.lines.length === 0}
        onClick={() => go("finish_service", { p_code: code.id, p_no_service: false }, true)}>{s.queue.done}</Button>
      <div className="grid grid-cols-2 gap-2">
        <Button variant="danger" disabled={pending || code.lines.length > 0}
          onClick={() => { if (confirm(s.queue.confirmNoService)) go("finish_service", { p_code: code.id, p_no_service: true }, true); }}>{s.queue.noService}</Button>
        <Button variant="secondary" disabled={pending} onClick={() => setHanding(!handing)}>{s.queue.handover}</Button>
      </div>
      {handing ? (
        <Card className="space-y-2">
          <div className="font-bold">{s.queue.pickColleague}</div>
          {data.colleagues.length === 0 ? <Notice>{s.app.none}</Notice> : null}
          {data.colleagues.map((p) => (
            <Button key={p.id} variant="secondary" className="w-full justify-between" disabled={pending}
              onClick={() => go("handover_code", { p_code: code.id, p_to: p.id }, true)}>
              <span>{p.name}</span><span className="text-sm">{p.on_duty ? s.shop.onDuty : s.shop.offDuty}</span>
            </Button>
          ))}
        </Card>
      ) : null}
    </div>
  );
}
