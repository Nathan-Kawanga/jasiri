"use client";
import { useState } from "react";
import { s, errorText } from "@/lib/strings";
import { Button, Notice } from "@/components/ui";
import { cancelBooking } from "../../actions";

export function CancelButton({ token }: { token: string }) {
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");
  const [error, setError] = useState<string | null>(null);
  if (state === "done") return <Notice tone="ok">{s.booking.cancelled}</Notice>;
  return (
    <div className="space-y-2">
      {error ? <Notice tone="error">{errorText(error)}</Notice> : null}
      <Button variant="dangerSolid" className="w-full" disabled={state === "busy"} onClick={async () => {
        if (!confirm(s.booking.confirmCancelPublic)) return;
        setState("busy");
        const r = await cancelBooking(token);
        if (r.ok) setState("done"); else { setError(r.error); setState("idle"); }
      }}>{s.booking.cancelLink}</Button>
    </div>
  );
}
