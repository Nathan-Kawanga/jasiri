"use client";
import { useState } from "react";
import { s } from "@/lib/strings";
import { useAct } from "@/lib/use-act";
import { Button, Card, Field, Notice, inputClass } from "@/components/ui";
import { ErrorNote } from "@/components/error-note";

export function ReportProblem({ shops, defaultShop }: { shops: { id: string; name: string }[]; defaultShop: string | null }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [shop, setShop] = useState(defaultShop ?? "");
  const [sent, setSent] = useState(false);
  const { run, pending, error } = useAct();
  if (sent) return <Notice tone="ok">{s.earnings.problemSent}</Notice>;
  if (!open) return <Button variant="danger" className="w-full" onClick={() => setOpen(true)}>{s.earnings.reportProblem}</Button>;
  return (
    <Card className="space-y-3">
      <div className="font-bold">{s.earnings.reportProblem}</div>
      <ErrorNote code={error} />
      {shops.length > 1 ? (
        <select className={inputClass} value={shop} onChange={(e) => setShop(e.target.value)}>
          {shops.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
        </select>
      ) : null}
      <Field label={s.earnings.problemNote}>
        <textarea className={`${inputClass} min-h-28 py-2`} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
      </Field>
      <Button disabled={pending || note.trim().length < 3} className="w-full"
        onClick={async () => { if (await run("report_problem", { p_shop: shop || null, p_note: note })) setSent(true); }}>{s.earnings.send}</Button>
    </Card>
  );
}
