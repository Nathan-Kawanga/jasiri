import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { serviceClient } from "@/lib/supabase/server";
import { clientIp, rateLimit } from "@/lib/ip";
import { s } from "@/lib/strings";
import { photoUrl } from "@/lib/photos";
import { Notice } from "@/components/ui";
import { Icon } from "@/components/icons";
import { BookingFlow, type PublicBarber } from "./flow";

async function load(handle: string): Promise<PublicBarber | null> {
  const { data } = await serviceClient().rpc("public_barber_page", { p_handle: handle });
  if (!data) return null;
  const b = data as PublicBarber;
  return { ...b, photos: b.photos ?? [], photo_path: b.photo_path ?? null, services: b.services ?? [], extras: b.extras ?? [] };
}

export async function generateMetadata({ params }: PageProps<"/b/[handle]">): Promise<Metadata> {
  const { handle } = await params;
  const b = await load(handle);
  if (!b) return { title: s.app.name };
  const image = photoUrl(b.photos[0]?.path ?? b.photo_path);
  return {
    title: `${s.booking.bookWith} ${b.name}`,
    description: b.about ?? `${b.name}${b.shop ? ` · ${b.shop.name}, ${b.shop.area}` : ""}`,
    openGraph: image ? { images: [image] } : undefined,
  };
}

export default async function PublicBarberPage({ params }: PageProps<"/b/[handle]">) {
  const { handle } = await params;
  if (!(await rateLimit(`page-ip:${await clientIp()}`, 120, 600))) {
    return <main className="mx-auto max-w-md p-4"><Notice tone="error">{s.errors.rate_limited as string}</Notice></main>;
  }
  const barber = await load(handle);
  if (!barber) notFound();
  const avatar = photoUrl(barber.photo_path);
  const cover = photoUrl(barber.photos[0]?.path ?? barber.photo_path);

  return (
    <main className="min-h-dvh bg-paper">
      <div className="relative h-56 w-full overflow-hidden">
        {cover ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={cover} alt="" className="size-full scale-110 object-cover opacity-60 blur-[2px]" />
        ) : <div className="mesh size-full" />}
        <div className="absolute inset-0 bg-gradient-to-b from-black/30 via-paper/40 to-paper" />
              </div>

      <div className="relative mx-auto -mt-20 w-full max-w-md px-4 pb-16">
        <div className="mb-3 size-28 overflow-hidden rounded-full border-4 border-paper bg-surface-2 shadow-xl ring-2 ring-brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {avatar ? <img src={avatar} alt={barber.name} className="size-full object-cover" />
            : <div className="gold-grad flex size-full items-center justify-center font-display text-4xl font-extrabold text-black">{barber.name[0]}</div>}
        </div>
        <h1 className="font-display text-4xl font-extrabold leading-tight">{barber.name}</h1>
        {barber.shop ? (
          <div className="mt-1 flex items-center gap-1.5 text-muted"><Icon name="store" size={18} />{barber.shop.name} · {barber.shop.area}</div>
        ) : null}
        {barber.about ? <p className="mt-4 whitespace-pre-line rounded-2xl border border-line bg-surface p-4 text-base">{barber.about}</p> : null}

        {barber.services.length || barber.extras.length ? (
          <section className="mt-6">
            <h2 className="mb-3 text-xl font-bold">{s.services.menu}</h2>
            <div className="divide-y divide-line rounded-2xl border border-line bg-surface">
              {barber.services.map((x) => (
                <div key={x.name} className="flex items-center justify-between px-4 py-3">
                  <span>{x.name}{x.minutes ? <span className="text-sm text-muted"> · {x.minutes} {s.booking.minutes}</span> : null}</span>
                  <b className="tabular-nums">KES {x.price}</b>
                </div>
              ))}
              {barber.extras.length ? <div className="px-4 pb-1 pt-3 text-sm font-semibold text-muted">{s.services.extras}</div> : null}
              {barber.extras.map((x) => (
                <div key={"x" + x.name} className="flex items-center justify-between px-4 py-3">
                  <span>{x.name}</span><span className="tabular-nums text-muted">{s.services.from} KES {x.price}</span>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {barber.photos.length ? (
          <section className="mt-6">
            <h2 className="mb-3 text-xl font-bold">{s.photos.myWork}</h2>
            <div className="no-scrollbar -mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-2">
              {barber.photos.map((p) => (
                <figure key={p.path} className="relative w-44 shrink-0 snap-start overflow-hidden rounded-3xl border border-line">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={photoUrl(p.path)!} alt={p.caption ?? barber.name} loading="lazy" className="aspect-[4/5] w-full object-cover" />
                  {p.caption ? <figcaption className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 to-transparent p-2.5 text-sm font-semibold">{p.caption}</figcaption> : null}
                </figure>
              ))}
            </div>
          </section>
        ) : null}

        <div className="mt-6 rounded-3xl border border-line bg-surface p-4">
          <BookingFlow barber={barber} />
        </div>
        <p className="mt-10 flex items-center justify-center gap-2 text-sm text-muted"><Icon name="scissors" size={16} />{s.booking.poweredBy}</p>
      </div>
    </main>
  );
}
