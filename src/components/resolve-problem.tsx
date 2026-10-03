"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { s } from "@/lib/strings";
import { useAct } from "@/lib/use-act";
import { Button, Input } from "./ui";
import { ErrorNote } from "./error-note";

export function Resolve({ id }: { id: string }) {
  const [note, setNote] = useState("");
  const { run, pending, error } = useAct();
  const router = useRouter();
  return (
    <div className="space-y-2">
      <ErrorNote code={error} />
      <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder={s.manager.resolutionNote} maxLength={500} />
      <Button variant="secondary" disabled={pending} className="w-full"
        onClick={async () => { if (await run("resolve_problem", { p_problem: id, p_note: note || null })) router.refresh(); }}>{s.manager.resolve}</Button>
    </div>
  );
}
