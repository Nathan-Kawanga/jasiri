import { notFound } from "next/navigation";
import { serviceClient } from "@/lib/supabase/server";
import { s } from "@/lib/strings";
import { time, dayLabel } from "@/lib/format";
import { Card, Notice } from "@/components/ui";
import { CancelButton } from "./cancel";

export default async function CancelPage({ params }: PageProps<"/b/c/[token]">) {
  const { token } = await params;
  if (!/^[0-9a-f]{36}$/.test(token)) notFound();
  const { data } = await serviceClient().rpc("public_booking", { p_token: token });
  if (!data) notFound();
  const b = data as { slot_start: string; status: string; barber_name: string; handle: string; masked_phone: string };
  return (
    <main className="mx-auto w-full max-w-md px-4 py-8">
      <Card className="space-y-3 text-center">
        <div className="text-2xl font-black">{b.barber_name}</div>
        <div className="text-xl">{dayLabel(b.slot_start)} · <b>{time(b.slot_start)}</b></div>
        <div className="text-muted tabular-nums">{b.masked_phone}</div>
        {b.status === "booked" && new Date(b.slot_start) > new Date()
          ? <CancelButton token={token} />
          : <Notice>{b.status === "cancelled" ? s.booking.cancelled : s.booking.status[b.status]}</Notice>}
        <a href={`/b/${b.handle}`} className="block min-h-12 py-3 font-semibold text-brand">{s.booking.bookWith} {b.barber_name}</a>
      </Card>
    </main>
  );
}
