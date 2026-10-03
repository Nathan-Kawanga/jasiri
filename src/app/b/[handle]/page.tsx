import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { serviceClient } from "@/lib/supabase/server";
import { clientIp, rateLimit } from "@/lib/ip";
import { s } from "@/lib/strings";
import { Notice } from "@/components/ui";
import { BookingFlow, type PublicBarber } from "./flow";

async function load(handle: string): Promise<PublicBarber | null> {
  const { data } = await serviceClient().rpc("public_barber_page", { p_handle: handle });
  return (data as PublicBarber) ?? null;
}

export async function generateMetadata({ params }: PageProps<"/b/[handle]">): Promise<Metadata> {
  const { handle } = await params;
  const b = await load(handle);
  return { title: b ? `${s.booking.bookWith} ${b.name}` : s.app.name };
}

export default async function PublicBarberPage({ params }: PageProps<"/b/[handle]">) {
  const { handle } = await params;
  if (!(await rateLimit(`page-ip:${await clientIp()}`, 120, 600))) {
    return <main className="mx-auto max-w-md p-4"><Notice tone="error">{s.errors.rate_limited as string}</Notice></main>;
  }
  const barber = await load(handle);
  if (!barber) notFound();
  return (
    <main className="mx-auto w-full max-w-md px-4 pb-16 pt-6">
      <header className="mb-5">
        <div className="text-3xl font-black">{barber.name}</div>
        {barber.shop ? <div className="text-lg text-muted">{barber.shop.name} · {barber.shop.area}</div> : null}
        {barber.about ? <p className="mt-3 whitespace-pre-line rounded-xl bg-white p-3">{barber.about}</p> : null}
      </header>
      <BookingFlow barber={barber} />
      <p className="mt-10 text-center text-sm text-muted">{s.booking.poweredBy}</p>
    </main>
  );
}
