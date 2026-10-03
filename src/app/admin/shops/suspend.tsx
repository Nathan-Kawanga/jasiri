"use client";
import { useRouter } from "next/navigation";
import { s } from "@/lib/strings";
import { useAct } from "@/lib/use-act";
import { Button } from "@/components/ui";

export function SuspendShop({ id, suspended }: { id: string; suspended: boolean }) {
  const { run, pending } = useAct();
  const router = useRouter();
  return (
    <Button variant={suspended ? "secondary" : "danger"} disabled={pending} onClick={async () => {
      if (await run("admin_set_shop_suspended", { p_shop: id, p_suspended: !suspended })) router.refresh();
    }}>{suspended ? s.admin.unsuspend : s.admin.suspend}</Button>
  );
}
