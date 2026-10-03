"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { s } from "@/lib/strings";
import { useAct } from "@/lib/use-act";
import { Button, Field, Input } from "@/components/ui";
import { ErrorNote } from "@/components/error-note";
import { selectShop } from "@/app/shop-actions";

export function NewShopForm() {
  const [name, setName] = useState("");
  const [area, setArea] = useState("");
  const { run, pending, error } = useAct();
  const router = useRouter();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const r = await run<{ shop_id: string }>("create_shop", { p_name: name, p_area: area });
    if (r) {
      await selectShop(r.shop_id);
      router.push("/shop/manage");
      router.refresh();
    }
  }
  return (
    <form onSubmit={submit} className="space-y-4">
      <ErrorNote code={error} />
      <Field label={s.shop.name}><Input value={name} onChange={(e) => setName(e.target.value)} required minLength={2} /></Field>
      <Field label={s.shop.area}><Input value={area} onChange={(e) => setArea(e.target.value)} required minLength={2} placeholder="e.g. Kahawa West" /></Field>
      <Button disabled={pending} className="w-full">{s.shop.create}</Button>
    </form>
  );
}
