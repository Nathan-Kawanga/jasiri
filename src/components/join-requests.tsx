"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { s } from "@/lib/strings";
import { useAct } from "@/lib/use-act";
import { read } from "@/lib/action";
import { Button } from "./ui";
import { ErrorNote } from "./error-note";

export type JoinRequest = {
  membership_id: string; name: string; requested_role: string | null; can_decide: boolean; manager_only: boolean;
  yes: number; no: number; needed: number; my_vote: boolean | null;
};

// Shown to everyone who works in the shop. Two coworkers must confirm a new person
// (one while the shop has a single member); owner/manager requests go to the manager.
export function JoinRequests({ shopId, initial, initialError }: { shopId: string; initial: JoinRequest[]; initialError?: string | null }) {
  const [list, setList] = useState(initial);
  const [loadError, setLoadError] = useState<string | null>(initialError ?? null);
  const { run, pending, error } = useAct();
  const router = useRouter();

  // New requests appear without anyone refreshing: check every 15 seconds and when the app comes back.
  useEffect(() => {
    let alive = true;
    const load = () => read<JoinRequest[]>("shop_join_requests", { p_shop: shopId })
      .then((r) => { if (alive) { setList(r ?? []); setLoadError(null); } })
      .catch((e: { code?: string }) => { if (alive) setLoadError(e.code ?? "generic"); });
    const timer = setInterval(load, 15_000);
    const onVisible = () => { if (document.visibilityState === "visible") load(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { alive = false; clearInterval(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, [shopId]);

  if (loadError) return <div className="mb-4"><ErrorNote code={loadError === "generic" ? "requests_failed" : loadError} /></div>;
  if (list.length === 0) return null;

  const decide = async (r: JoinRequest, approve: boolean) => {
    const res = await run<{ result: string; yes?: number; no?: number }>("decide_join", {
      p_membership: r.membership_id, p_approve: approve, p_roles: r.requested_role ? [r.requested_role] : [],
    });
    if (!res) return;
    if (res.result === "pending") {
      setList((l) => l.map((x) => x.membership_id === r.membership_id
        ? { ...x, my_vote: approve, yes: res.yes ?? x.yes, no: res.no ?? x.no } : x));
    } else {
      setList((l) => l.filter((x) => x.membership_id !== r.membership_id));
      router.refresh();
    }
  };

  return (
    <section className="mb-4 space-y-2 rounded-3xl border border-brand/40 bg-brand/5 p-4">
      <h2 className="text-lg font-bold">{s.shop.requestsTitle}</h2>
      <ErrorNote code={error} />
      {list.map((r) => (
        <div key={r.membership_id} className="rounded-2xl border border-line bg-surface p-3">
          <div className="flex items-baseline justify-between gap-2">
            <div className="font-bold">{r.name}</div>
            {!r.manager_only && typeof r.needed === "number" ? <div className="text-xs font-semibold text-brand">{s.shop.confirmedOf(r.yes, r.needed)}</div> : null}
          </div>
          <div className="mb-2 text-sm text-muted">{r.requested_role === "manager" ? s.shop.roleOwner : s.shop.role[r.requested_role ?? ""] ?? "—"}</div>
          {!r.can_decide ? (
            <div className="text-sm text-amber-300">{s.shop.managerMustApprove}</div>
          ) : r.my_vote === true ? (
            <div className="text-sm text-emerald-300">{s.shop.youSaidYes}</div>
          ) : (
            <>
              {r.my_vote === false ? <div className="mb-2 text-sm text-muted">{s.shop.youSaidNo}</div> : null}
              <div className="grid grid-cols-2 gap-2">
                <Button disabled={pending} onClick={() => decide(r, true)}>{s.shop.yesWorksHere}</Button>
                {r.my_vote !== false ? <Button variant="danger" disabled={pending} onClick={() => decide(r, false)}>{s.shop.notHere}</Button> : null}
              </div>
            </>
          )}
        </div>
      ))}
    </section>
  );
}
