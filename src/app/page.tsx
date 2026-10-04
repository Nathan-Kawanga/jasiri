import Link from "next/link";
import { redirect } from "next/navigation";
import { getContext } from "@/lib/context";
import { serviceClient } from "@/lib/supabase/server";
import { Landing } from "./landing";
import { s } from "@/lib/strings";
import { dayLabel } from "@/lib/format";
import { photoUrl } from "@/lib/photos";
import { Notice } from "@/components/ui";
import { Icon, type IconName } from "@/components/icons";
import { switchShop } from "./shop-actions";
import { signOut } from "./auth-actions";


function Tile({ href, label, icon }: { href: string; label: string; icon: IconName }) {
  return (
    <Link href={href} className="flex min-h-28 flex-col justify-between rounded-3xl border border-line bg-surface p-4 transition hover:border-brand/40 active:scale-[0.97]">
      <span className="inline-flex size-11 items-center justify-center rounded-2xl bg-brand/10 text-brand">
        <Icon name={icon} />
      </span>
      <span className="mt-3 text-base font-bold leading-tight">{label}</span>
    </Link>
  );
}

function HeroTile({ href, label, hint, icon }: { href: string; label: string; hint: string; icon: IconName }) {
  return (
    <Link href={href} className="gold-grad shine relative col-span-2 flex min-h-32 items-center justify-between overflow-hidden rounded-3xl p-5 text-black active:scale-[0.98]">
      <div>
        <div className="font-display text-3xl font-extrabold">{label}</div>
        <div className="text-sm font-semibold text-black/70">{hint}</div>
      </div>
      <span className="inline-flex size-16 items-center justify-center rounded-full bg-black/85 text-brand">
        <Icon name={icon} size={30} />
      </span>
          </Link>
  );
}

function greeting() {
  const h = Number(new Intl.DateTimeFormat("en-KE", { timeZone: "Africa/Nairobi", hour: "numeric", hour12: false }).format(new Date()));
  return h < 12 ? s.home.goodMorning : h < 17 ? s.home.goodAfternoon : s.home.goodEvening;
}

export default async function Home() {
  const ctx = await getContext();
  if (!ctx) {
    const { data } = await serviceClient().from("app_settings").select("value").eq("key", "monthly_price_kes").maybeSingle();
    return <Landing price={data?.value ?? "200"} />;
  }
  if (ctx.profile.suspended) redirect("/suspended");
  const { profile, shops, usableShops, current, roles } = ctx;
  const has = (r: string) => roles.includes(r as never);
  const pending = shops.filter((m) => m.status === "pending");
  const first = profile.full_name.split(" ")[0];
  const avatar = photoUrl(profile.photo_path);

  return (
    <main className="mesh min-h-dvh">
      <div className="mx-auto w-full max-w-xl px-4 pb-20 pt-5">
        <header className="mb-5 flex items-center justify-between">
          <div className="font-display text-2xl font-extrabold"><span className="gold-text">Jasiri</span></div>
          <div className="flex items-center gap-2">
            <Link href="/account" aria-label={s.home.account}
              className="inline-flex size-12 items-center justify-center overflow-hidden rounded-full border border-line bg-surface">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {avatar ? <img src={avatar} alt="" className="size-full object-cover" /> : <Icon name="user" />}
            </Link>
            <form action={signOut}>
              <button className="inline-flex min-h-12 items-center gap-1.5 rounded-full border border-line bg-surface px-4 text-sm font-semibold text-muted hover:text-ink">
                <Icon name="logout" size={18} />{s.app.signOut}
              </button>
            </form>
          </div>
        </header>

        <section className="mb-5">
          <p className="text-muted">{greeting()},</p>
          <h1 className="font-display text-4xl font-extrabold leading-tight">{first}</h1>
        </section>

        {profile.subscription === "due" ? (
          <div className="mb-4"><Notice tone="warn">
            <b>{s.home.payDue}</b><br />{s.app.kes} {profile.monthly_price_kes} {s.home.perMonth}. {profile.payment_instructions}
          </Notice></div>
        ) : profile.subscription === "trial" ? (
          <p className="mb-4 inline-block rounded-full bg-brand/15 px-3 py-1 text-sm font-semibold text-brand">{s.home.trialEnds}: {dayLabel(profile.trial_ends_at)}</p>
        ) : null}

        {current ? (
          <section className="mb-4 overflow-hidden rounded-3xl border border-line bg-surface">
            <div className="flex items-center gap-3 p-4">
              <span className="inline-flex size-12 items-center justify-center rounded-2xl bg-brand/15 text-brand"><Icon name="store" /></span>
              <div className="min-w-0 flex-1">
                <div className="truncate font-display text-xl font-bold">{current.name}</div>
                <div className="truncate text-sm text-muted">{current.area} · {current.roles.map((r) => s.shop.role[r]).join(", ")}</div>
              </div>
            </div>
            {usableShops.length > 1 ? (
              <form action={switchShop} className="flex gap-2 border-t border-line p-3">
                <select name="shop_id" defaultValue={current.shop_id} className="min-h-12 flex-1 rounded-xl border border-line bg-surface-2 px-2 text-ink">
                  {usableShops.map((m) => <option key={m.shop_id} value={m.shop_id}>{m.name}</option>)}
                </select>
                <button className="min-h-12 rounded-xl bg-surface-2 px-3 font-semibold">{s.home.switchShop}</button>
              </form>
            ) : null}
          </section>
        ) : (
          <div className="mb-4"><Notice>{s.home.noShop} {profile.is_barber ? s.home.noShopBarber : null}</Notice></div>
        )}

        {pending.map((m) => (
          <div key={m.membership_id} className="mb-3"><Notice tone="warn"><b>{m.name}</b>: {s.home.pending}</Notice></div>
        ))}

        <div className="grid grid-cols-2 gap-3">
          {current && has("barber") ? <HeroTile href="/code/new" label={s.home.newCode} hint={s.home.newCodeHint} icon="scissors" /> : null}
          {current && has("service_staff") && !has("barber") ? <HeroTile href="/queue" label={s.home.queue} hint={s.home.queueHint} icon="sparkles" /> : null}
          {current && has("cashier") && !has("barber") && !has("service_staff") ? <HeroTile href="/cashier" label={s.home.cashier} hint={s.home.cashierHint} icon="cash" /> : null}
          {current && has("service_staff") && has("barber") ? <Tile href="/queue" label={s.home.queue} icon="sparkles" /> : null}
          {current && has("cashier") && (has("barber") || has("service_staff")) ? <Tile href="/cashier" label={s.home.cashier} icon="cash" /> : null}
          {profile.is_barber ? <>
            <Tile href="/day" label={s.home.myDay} icon="calendar" />
            <Tile href="/clients" label={s.home.clientBook} icon="book" />
          </> : null}
          {profile.is_barber || has("service_staff") || has("barber") ? <Tile href="/earnings" label={s.home.earnings} icon="wallet" /> : null}
          {profile.is_barber ? <>
            <Tile href="/photos" label={s.home.myCuts} icon="image" />
            <Tile href="/share" label={s.home.bookingLink} icon="link" />
            <Tile href="/availability" label={s.home.availability} icon="clock" />
          </> : null}
          {current && (has("cashier") || has("manager")) ? <>
            <Tile href="/shop/payout" label={s.home.payout} icon="list" />
            <Tile href="/shop/summary" label={s.home.summary} icon="chart" />
          </> : null}
          {current && has("manager") ? <>
            <Tile href="/shop/manage" label={s.home.manage} icon="users" />
            <Tile href="/shop/flags" label={s.home.flags} icon="flag" />
            <Tile href="/shop/usage" label={s.home.usage} icon="chart" />
            <Tile href="/shop/problems" label={s.home.problems} icon="alert" />
            <Tile href="/shop/audit" label={s.home.audit} icon="shield" />
          </> : null}
          {profile.is_platform_admin ? <Tile href="/admin" label={s.home.admin} icon="shield" /> : null}
          <Tile href="/guide" label={s.home.guide} icon="help" />
        </div>

        <div className="mt-6 grid grid-cols-2 gap-3 text-sm">
          <Link href="/shop/new" className="flex min-h-12 items-center justify-center gap-2 rounded-2xl border border-dashed border-line text-muted"><Icon name="plus" size={18} />{s.home.createShop}</Link>
          <Link href="/shop/join" className="flex min-h-12 items-center justify-center gap-2 rounded-2xl border border-dashed border-line text-muted"><Icon name="users" size={18} />{s.home.joinShop}</Link>
        </div>
      </div>
    </main>
  );
}
