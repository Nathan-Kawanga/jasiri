"use client";
import { useState } from "react";
import { s } from "@/lib/strings";
import { useAct } from "@/lib/use-act";
import { read } from "@/lib/action";
import { Button, Card, Field, Input, Notice, LinkButton } from "@/components/ui";
import { ErrorNote } from "@/components/error-note";

type Shop = { id: string; name: string; area: string };

export function JoinForm({ initialCode }: { initialCode: string }) {
  const [code, setCode] = useState(initialCode.toUpperCase());
  const [shop, setShop] = useState<Shop | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const { run, pending, error } = useAct();

  async function find(e: React.FormEvent) {
    e.preventDefault();
    setLookupError(null);
    const r = await read<Shop | null>("shop_by_join_code", { p_code: code }).catch(() => null);
    if (!r) setLookupError("shop_not_found");
    setShop(r);
  }

  async function join() {
    const r = await run("request_join", { p_code: code });
    if (r) setSent(true);
  }

  if (sent) return <div className="space-y-4"><Notice tone="ok">{s.shop.requestSent}</Notice><LinkButton href="/" className="w-full">{s.app.home}</LinkButton></div>;

  return (
    <div className="space-y-4">
      <form onSubmit={find} className="space-y-4">
        <ErrorNote code={lookupError} />
        <Field label={s.shop.joinCode} hint={s.shop.joinCodeHint}>
          <Input value={code} onChange={(e) => { setCode(e.target.value.toUpperCase().trim()); setShop(null); }}
                 maxLength={6} autoCapitalize="characters" className="font-mono text-2xl tracking-widest" required />
        </Field>
        {!shop ? <Button className="w-full" variant="secondary">{s.shop.findShop}</Button> : null}
      </form>
      {shop ? (
        <Card className="space-y-3">
          <div className="text-xl font-bold">{shop.name}</div>
          <div className="text-muted">{shop.area}</div>
          <ErrorNote code={error} />
          <Button onClick={join} disabled={pending} className="w-full">{s.shop.askToJoin}</Button>
        </Card>
      ) : null}
    </div>
  );
}
