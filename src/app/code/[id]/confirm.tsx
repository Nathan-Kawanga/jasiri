"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { s } from "@/lib/strings";
import { kes } from "@/lib/format";
import { useAct } from "@/lib/use-act";
import { Button, LinkButton, Notice } from "@/components/ui";
import { ErrorNote } from "@/components/error-note";

export type CodeView = {
  id: string; display_code: string; status: string; barber_amount: number; client_first_name: string | null;
  assigned_staff_id: string | null; barber_id: string | null; staff_name: string | null;
};
type Result = { status: string; assigned_staff_name: string | null; assigned_staff_id: string | null };

export function CodeConfirm({ code }: { code: CodeView }) {
  const [state, setState] = useState<Result>({ status: code.status, assigned_staff_name: code.staff_name, assigned_staff_id: code.assigned_staff_id });
  const { run, pending, error } = useAct();
  const router = useRouter();
  const serviceOnly = !code.barber_id;

  const big = (
    <div className="relative my-6 overflow-hidden rounded-3xl border border-line bg-surface px-4 py-8 text-center">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_60%_at_50%_0%,rgba(255,178,30,0.18),transparent)]" />
      <div data-testid="code" className="glow relative font-mono text-7xl font-black tracking-[0.2em] text-brand" aria-label={code.display_code.split("").join(" ")}>{code.display_code}</div>
      {code.client_first_name ? <div className="relative mt-3 text-xl font-semibold">{code.client_first_name}</div> : null}
      {!serviceOnly ? <div className="relative text-xl text-muted">{kes(code.barber_amount)}</div> : null}
    </div>
  );

  if (state.status === "created") {
    return (
      <div>
        <p className="text-center text-lg font-semibold text-muted">{s.code.showToClient}</p>
        {big}
        <ErrorNote code={error} />
        <button disabled={pending}
          onClick={async () => { const r = await run<Result>("confirm_code", { p_code: code.id }); if (r) setState(r); }}
          className="pulse-ring shine mt-4 min-h-24 w-full rounded-3xl gold-grad font-display text-3xl font-extrabold text-black active:scale-[0.98] disabled:opacity-60">
          {s.code.confirmMyCode}
        </button>
        <p className="mt-2 text-center text-sm text-muted">{s.code.clientTaps}</p>
        <Button variant="ghost" className="mt-8 w-full" disabled={pending}
          onClick={async () => { if (confirm(s.code.confirmCancel) && await run("cancel_code", { p_code: code.id })) router.replace(serviceOnly ? "/queue" : "/"); }}>
          {s.code.cancelCode}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {big}
      {state.status === "open" ? (
        serviceOnly ? (
          <Notice tone="ok">{s.code.cashierCanSee}</Notice>
        ) : state.assigned_staff_name ? (
          <div className="shine rounded-3xl gold-grad p-6 text-center text-black">
            <div className="text-lg">{s.code.sendTo}</div>
            <div data-testid="sent-to" className="font-display text-4xl font-extrabold">{state.assigned_staff_name}</div>
          </div>
        ) : (
          <Notice tone="warn">{s.code.unassigned}</Notice>
        )
      ) : (
        <Notice>{s.code.status[state.status]}</Notice>
      )}
      {!serviceOnly ? <p className="text-center text-muted">{s.code.cashierCanSee}</p> : null}
      <LinkButton href={serviceOnly ? "/queue" : "/code/new"} className="min-h-16 w-full text-xl">{serviceOnly ? s.queue.title : s.code.newAnother}</LinkButton>
      <LinkButton href="/" variant="secondary" className="w-full">{s.app.home}</LinkButton>
    </div>
  );
}
