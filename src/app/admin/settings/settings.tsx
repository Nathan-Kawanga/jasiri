"use client";
import { useState } from "react";
import { s } from "@/lib/strings";
import { useAct } from "@/lib/use-act";
import { Button, Card, Field, Input, Notice, inputClass } from "@/components/ui";
import { ErrorNote } from "@/components/error-note";

export function Settings({ instructions, price }: { instructions: string; price: string }) {
  const [text, setText] = useState(instructions);
  const [kes, setKes] = useState(price);
  const [saved, setSaved] = useState(false);
  const { run, pending, error } = useAct();
  return (
    <Card className="space-y-4">
      <ErrorNote code={error} />
      {saved ? <Notice tone="ok">{s.app.saved}</Notice> : null}
      <Field label={s.admin.monthlyPrice}><Input value={kes} onChange={(e) => setKes(e.target.value.replace(/\D/g, ""))} inputMode="numeric" /></Field>
      <Field label={s.admin.paymentInstructions}>
        <textarea className={`${inputClass} min-h-28 py-2`} value={text} onChange={(e) => setText(e.target.value)} />
      </Field>
      <Button disabled={pending} className="w-full" onClick={async () => {
        setSaved(false);
        const a = await run("admin_set_setting", { p_key: "monthly_price_kes", p_value: kes });
        const b = a && (await run("admin_set_setting", { p_key: "payment_instructions", p_value: text }));
        if (b) setSaved(true);
      }}>{s.app.save}</Button>
    </Card>
  );
}
