import Link from "next/link";
import { requireContext } from "@/lib/context";
import { s } from "@/lib/strings";
import { dayLabel } from "@/lib/format";
import { LinkButton, Notice } from "@/components/ui";
import { switchShop } from "./shop-actions";

function Tile({ href, label, primary }: { href: string; label: string; primary?: boolean }) {
  return (
    <Link href={href}
      className={`flex min-h-20 items-center justify-center rounded-2xl p-3 text-center text-lg font-bold active:scale-[0.98] ${
        primary ? "col-span-2 min-h-24 bg-brand text-2xl text-white" : "border-2 border-line bg-white text-ink"}`}>
      {label}
    </Link>
  );
}

export default async function Home() {
  const { profile, shops, usableShops, current, roles } = await requireContext();
  const has = (r: string) => roles.includes(r as never);
  const pending = shops.filter((m) => m.status === "pending");
  const first = profile.full_name.split(" ")[0];

  return (
    <main className="mx-auto w-full max-w-xl px-4 pb-16 pt-4">
      <header className="mb-4 flex items-center justify-between">
        <div>
          <div className="text-2xl font-black text-brand">{s.app.name}</div>
          <div className="text-muted">{s.home.hello}, {first}</div>
        </div>
        <Link href="/account" className="min-h-12 rounded-xl border-2 border-line px-3 py-2.5 font-semibold">{s.home.account}</Link>
      </header>

      {profile.subscription === "due" ? (
        <div className="mb-4"><Notice tone="warn">
          <b>{s.home.payDue}</b><br />{s.app.kes} {profile.monthly_price_kes} {s.home.perMonth}. {profile.payment_instructions}
        </Notice></div>
      ) : profile.subscription === "trial" ? (
        <p className="mb-4 text-sm text-muted">{s.home.trialEnds}: {dayLabel(profile.trial_ends_at)}</p>
      ) : null}

      {current ? (
        <section className="mb-4 rounded-2xl bg-ink p-4 text-white">
          <div className="text-xl font-bold">{current.name}</div>
          <div className="text-sm opacity-80">{current.area} · {current.roles.map((r) => s.shop.role[r]).join(", ")}</div>
          {usableShops.length > 1 ? (
            <form action={switchShop} className="mt-3 flex gap-2">
              <select name="shop_id" defaultValue={current.shop_id} className="min-h-12 flex-1 rounded-xl px-2 text-ink">
                {usableShops.map((m) => <option key={m.shop_id} value={m.shop_id}>{m.name}</option>)}
              </select>
              <button className="min-h-12 rounded-xl bg-white px-3 font-semibold text-ink">{s.home.switchShop}</button>
            </form>
          ) : null}
        </section>
      ) : (
        <section className="mb-4 space-y-3">
          <Notice>{s.home.noShop} {profile.is_barber ? s.home.noShopBarber : null}</Notice>
        </section>
      )}

      {pending.map((m) => (
        <div key={m.membership_id} className="mb-3"><Notice tone="warn"><b>{m.name}</b>: {s.home.pending}</Notice></div>
      ))}

      <div className="grid grid-cols-2 gap-3">
        {current && has("barber") ? <Tile href="/code/new" label={s.home.newCode} primary /> : null}
        {current && has("service_staff") ? <Tile href="/queue" label={s.home.queue} primary={!has("barber")} /> : null}
        {current && has("cashier") ? <Tile href="/cashier" label={s.home.cashier} primary={!has("barber") && !has("service_staff")} /> : null}
        {profile.is_barber ? <>
          <Tile href="/day" label={s.home.myDay} />
          <Tile href="/clients" label={s.home.clientBook} />
        </> : null}
        {profile.is_barber || has("service_staff") || has("barber") ? <Tile href="/earnings" label={s.home.earnings} /> : null}
        {profile.is_barber ? <>
          <Tile href="/share" label={s.home.bookingLink} />
          <Tile href="/availability" label={s.home.availability} />
        </> : null}
        {current && (has("cashier") || has("manager")) ? <>
          <Tile href="/shop/payout" label={s.home.payout} />
          <Tile href="/shop/summary" label={s.home.summary} />
        </> : null}
        {current && has("manager") ? <>
          <Tile href="/shop/manage" label={s.home.manage} />
          <Tile href="/shop/flags" label={s.home.flags} />
          <Tile href="/shop/usage" label={s.home.usage} />
          <Tile href="/shop/problems" label={s.home.problems} />
          <Tile href="/shop/audit" label={s.home.audit} />
        </> : null}
        {profile.is_platform_admin ? <Tile href="/admin" label={s.home.admin} /> : null}
        <Tile href="/guide" label={s.home.guide} />
      </div>

      <div className={`mt-6 grid grid-cols-2 gap-3 ${current ? "text-sm" : ""}`}>
        <LinkButton href="/shop/new" variant={current ? "ghost" : "secondary"}>{s.home.createShop}</LinkButton>
        <LinkButton href="/shop/join" variant={current ? "ghost" : "secondary"}>{s.home.joinShop}</LinkButton>
      </div>
    </main>
  );
}
