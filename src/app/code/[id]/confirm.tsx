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
    <div className="my-6 text-center">
      <div className="font-mono text-7xl font-black tracking-[0.2em] text-ink" aria-label={code.display_code.split("").join(" ")}>{code.display_code}</div>
      {code.client_first_name ? <div className="mt-2 text-xl font-semibold">{code.client_first_name}</div> : null}
      {!serviceOnly ? <div className="text-xl text-muted">{kes(code.barber_amount)}</div> : null}
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
          className="mt-4 min-h-24 w-full rounded-2xl bg-brand text-2xl font-black text-white active:scale-[0.98] disabled:opacity-60">
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
          <div className="rounded-2xl bg-brand p-5 text-center text-white">
            <div className="text-lg">{s.code.sendTo}</div>
            <div className="text-4xl font-black">{state.assigned_staff_name}</div>
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
