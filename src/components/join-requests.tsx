"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { s } from "@/lib/strings";
import { useAct } from "@/lib/use-act";
import { Button } from "./ui";
import { ErrorNote } from "./error-note";

export type JoinRequest = { membership_id: string; name: string; requested_role: string | null; can_decide: boolean };

// Shown on the home screen of everyone who works in the shop: any coworker can vouch.
export function JoinRequests({ initial }: { initial: JoinRequest[] }) {
  const [list, setList] = useState(initial);
  const { run, pending, error } = useAct();
  const router = useRouter();
  if (list.length === 0) return null;

  const decide = async (r: JoinRequest, approve: boolean) => {
    const ok = await run("decide_join", { p_membership: r.membership_id, p_approve: approve, p_roles: r.requested_role ? [r.requested_role] : [] });
    if (ok) { setList((l) => l.filter((x) => x.membership_id !== r.membership_id)); router.refresh(); }
  };

  return (
    <section className="mb-4 space-y-2 rounded-3xl border border-brand/40 bg-brand/5 p-4">
      <h2 className="text-lg font-bold">{s.shop.requestsTitle}</h2>
      <ErrorNote code={error} />
      {list.map((r) => (
        <div key={r.membership_id} className="rounded-2xl border border-line bg-surface p-3">
          <div className="font-bold">{r.name}</div>
          <div className="mb-2 text-sm text-muted">{r.requested_role === "manager" ? s.shop.roleOwner : s.shop.role[r.requested_role ?? ""] ?? "—"}</div>
          {r.can_decide ? (
            <div className="grid grid-cols-2 gap-2">
              <Button disabled={pending} onClick={() => decide(r, true)}>{s.shop.yesWorksHere}</Button>
              <Button variant="danger" disabled={pending} onClick={() => decide(r, false)}>{s.shop.notHere}</Button>
            </div>
          ) : <div className="text-sm text-amber-300">{s.shop.managerMustApprove}</div>}
        </div>
      ))}
    </section>
  );
}
