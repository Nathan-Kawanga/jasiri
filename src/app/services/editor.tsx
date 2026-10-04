"use client";
import { useState } from "react";
import { s } from "@/lib/strings";
import { useAct } from "@/lib/use-act";
import { Button, Card, Notice, inputClass } from "@/components/ui";
import { ErrorNote } from "@/components/error-note";
import { Icon } from "@/components/icons";

export type Service = { id?: string; name: string; price: number | string; minutes?: number | string | null };

export function ServicesEditor({ initial, barber }: { initial: Service[]; barber: boolean }) {
  const [items, setItems] = useState<Service[]>(initial.length ? initial : []);
  const [saved, setSaved] = useState(false);
  const { run, pending, error } = useAct();
  const suggest = (barber ? s.services.barberSuggest : s.services.staffSuggest)
    .filter((n) => !items.some((i) => i.name.toLowerCase() === n.toLowerCase()));
  const set = (i: number, patch: Partial<Service>) => { setSaved(false); setItems(items.map((x, j) => (j === i ? { ...x, ...patch } : x))); };

  async function save() {
    const clean = items
      .filter((i) => i.name.trim() && String(i.price) !== "")
      .map((i) => ({ name: i.name.trim(), price: Number(i.price), minutes: i.minutes ? Number(i.minutes) : null }));
    if (await run("save_my_services", { p_items: clean })) setSaved(true);
  }

  return (
    <div className="space-y-4">
      <Notice>{barber ? s.services.hint : s.services.hintStaff}</Notice>
      <ErrorNote code={error} />
      {saved ? <Notice tone="ok">{s.services.saved}</Notice> : null}
      {items.length === 0 ? <p className="rounded-3xl border border-dashed border-line py-6 text-center text-muted">{s.services.empty}</p> : null}
      <Card className="space-y-2">
        {items.map((it, i) => (
          <div key={i} className="space-y-2 rounded-2xl border border-line bg-surface-2/50 p-2.5">
            <div className="flex items-center gap-2">
              <input className={`${inputClass} px-3 text-base`} value={it.name} maxLength={40}
                placeholder={s.services.name} aria-label={s.services.name} onChange={(e) => set(i, { name: e.target.value })} />
              <button className="inline-flex size-10 shrink-0 items-center justify-center text-xl text-red-400" aria-label="Remove"
                onClick={() => { setSaved(false); setItems(items.filter((_, j) => j !== i)); }}>×</button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <label className="flex items-center gap-2 text-sm text-muted">{s.services.price}
                <input className={`${inputClass} px-3 text-base tabular-nums`} value={it.price} inputMode="numeric"
                  aria-label={s.services.price} onChange={(e) => set(i, { price: e.target.value.replace(/\D/g, "") })} />
              </label>
              {barber ? (
                <label className="flex items-center gap-2 text-sm text-muted">{s.services.minutes}
                  <input className={`${inputClass} px-3 text-base tabular-nums`} value={it.minutes ?? ""} inputMode="numeric"
                    aria-label={s.services.minutes} onChange={(e) => set(i, { minutes: e.target.value.replace(/\D/g, "") })} />
                </label>
              ) : null}
            </div>
          </div>
        ))}
        <Button variant="secondary" className="w-full" onClick={() => setItems([...items, { name: "", price: "" }])}>
          <Icon name="plus" size={18} />{s.services.add}
        </Button>
      </Card>
      {suggest.length ? (
        <div>
          <div className="mb-2 text-sm font-semibold text-muted">{s.services.suggestions}</div>
          <div className="flex flex-wrap gap-2">
            {suggest.map((n) => (
              <button key={n} onClick={() => { setSaved(false); setItems([...items, { name: n, price: "" }]); }}
                className="min-h-10 rounded-full border border-line bg-surface-2 px-3 text-sm font-semibold">+ {n}</button>
            ))}
          </div>
        </div>
      ) : null}
      <Button className="w-full" disabled={pending} onClick={save}>{s.services.save}</Button>
    </div>
  );
}
