import Link from "next/link";
import { s } from "@/lib/strings";
import { site } from "@/lib/site";
import { btn } from "@/components/ui";
import { Icon, type IconName } from "@/components/icons";

const L = s.landing;

function Logo() {
  return (
    <Link href="/" className="flex items-center gap-2.5">
      <span className="gold-grad inline-flex size-9 items-center justify-center rounded-xl text-black"><Icon name="scissors" size={20} /></span>
      <span className="font-display text-xl font-extrabold">Jasiri</span>
    </Link>
  );
}

function PhoneMock() {
  return (
    <div className="mx-auto w-64 rounded-[2.6rem] border border-line bg-surface p-2.5 shadow-2xl shadow-black/60">
      <div className="overflow-hidden rounded-[2rem] bg-paper">
        <div className="flex items-center justify-between px-5 pt-4 text-xs text-muted"><span>9:41</span><span>{L.mockShop}</span></div>
        <div className="px-4 pb-5 pt-6">
          <div className="rounded-2xl border border-line bg-surface px-3 py-6 text-center">
            <div className="glow font-mono text-5xl font-black tracking-[0.18em] text-brand">K7QM</div>
            <div className="mt-2 text-sm font-semibold">Baraka</div>
            <div className="text-xs text-muted">KES 300</div>
          </div>
          <div className="mt-4 rounded-2xl gold-grad py-4 text-center font-display text-lg font-extrabold text-black">{s.code.confirmMyCode}</div>
          <div className="mt-4 rounded-2xl border border-line bg-surface p-3 text-center">
            <div className="text-xs text-muted">{L.mockSendTo}</div>
            <div className="font-display text-xl font-bold">{L.mockStaff}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function BookingMock() {
  const times = ["10:00", "10:30", "11:00", "11:30", "14:00", "14:30"];
  return (
    <div className="mx-auto w-64 rounded-[2.6rem] border border-line bg-surface p-2.5 shadow-2xl shadow-black/60">
      <div className="overflow-hidden rounded-[2rem] bg-paper p-4">
        <div className="flex items-center gap-3">
          <div className="gold-grad flex size-12 items-center justify-center rounded-full font-display text-xl font-extrabold text-black">B</div>
          <div><div className="font-display font-bold">Brian Kamau</div><div className="text-xs text-muted">Kinyozi Bora · Kahawa West</div></div>
        </div>
        <div className="mt-4 grid grid-cols-3 gap-1.5">
          {["Taper", "Fade", "Waves"].map((t) => (
            <div key={t} className="flex aspect-[4/5] items-end rounded-xl border border-line bg-gradient-to-b from-surface-2 to-surface p-1.5 text-[10px] font-semibold text-muted">{t}</div>
          ))}
        </div>
        <div className="mt-4 text-xs font-semibold">{s.booking.pickTime}</div>
        <div className="mt-2 grid grid-cols-3 gap-1.5">
          {times.map((t) => <div key={t} className="rounded-lg border border-brand/30 bg-brand/10 py-1.5 text-center text-xs font-bold text-amber-200">{t}</div>)}
        </div>
      </div>
    </div>
  );
}

export function Landing({ price }: { price: string }) {
  const c = site.contact;
  const contacts: { icon: IconName; label: string; value: string; href?: string }[] = [
    { icon: "link", label: L.email, value: c.email, href: `mailto:${c.email}` },
    { icon: "phone", label: L.phone, value: c.phone, href: `tel:${c.phone.replace(/\s/g, "")}` },
    { icon: "users", label: L.whatsapp, value: c.phone, href: `https://wa.me/${c.whatsapp}` },
    { icon: "image", label: L.instagram, value: `@${c.instagram}`, href: `https://instagram.com/${c.instagram}` },
    { icon: "store", label: L.location, value: c.location },
  ];

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-20 border-b border-line/60 bg-paper/80 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4">
          <Logo />
          <nav className="hidden items-center gap-7 text-sm text-muted md:flex">
            <a href="#how" className="hover:text-ink">{L.nav.how}</a>
            <a href="#features" className="hover:text-ink">{L.nav.features}</a>
            <a href="#pricing" className="hover:text-ink">{L.nav.pricing}</a>
            <a href="#contact" className="hover:text-ink">{L.nav.contact}</a>
          </nav>
          <div className="flex items-center gap-2">
            <Link href="/login" className={btn("secondary", "min-h-10 px-4 text-sm")}>{L.signIn}</Link>
            <Link href="/signup" className={btn("primary", "hidden min-h-10 px-4 text-sm sm:inline-flex")}>{L.getStarted}</Link>
          </div>
        </div>
      </header>

      <main>
        <section className="mesh">
          <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 pb-16 pt-12 md:grid-cols-2 md:pt-20">
            <div>
              <span className="inline-block rounded-full border border-brand/30 bg-brand/10 px-3 py-1 text-sm font-semibold text-brand">{L.eyebrow}</span>
              <h1 className="mt-5 font-display text-5xl font-extrabold leading-[1.02] md:text-6xl">{L.title}</h1>
              <p className="mt-5 max-w-xl text-lg text-muted">{L.sub}</p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <Link href="/signup" className={btn("primary", "min-h-14 px-7 text-lg")}>{L.ctaPrimary}</Link>
                <a href="#how" className={btn("secondary", "min-h-14 px-7 text-lg")}>{L.ctaSecondary}</a>
              </div>
              <p className="mt-4 text-sm text-muted">{L.freeNote}</p>
            </div>
            <PhoneMock />
          </div>
        </section>

        <section className="border-y border-line bg-surface/50">
          <div className="mx-auto grid max-w-6xl grid-cols-2 gap-6 px-4 py-10 md:grid-cols-4">
            {site.stats.map((x) => (
              <div key={x.label}>
                <div className="font-display text-3xl font-extrabold text-brand md:text-4xl">{x.value}</div>
                <div className="mt-1 text-sm text-muted">{x.label}</div>
              </div>
            ))}
          </div>
        </section>

        <section id="how" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-20">
          <h2 className="font-display text-4xl font-extrabold">{L.howTitle}</h2>
          <p className="mt-2 text-lg text-muted">{L.howSub}</p>
          <div className="mt-10 grid gap-4 md:grid-cols-3">
            {L.steps.map((st, i) => (
              <div key={st.t} className="rounded-3xl border border-line bg-surface p-6">
                <div className="flex size-10 items-center justify-center rounded-full border border-brand/40 font-display text-lg font-bold text-brand">{i + 1}</div>
                <h3 className="mt-4 text-xl font-bold">{st.t}</h3>
                <p className="mt-2 text-muted">{st.d}</p>
              </div>
            ))}
          </div>
        </section>

        <section id="features" className="scroll-mt-20 border-t border-line bg-surface/30">
          <div className="mx-auto max-w-6xl px-4 py-20">
            <h2 className="font-display text-4xl font-extrabold">{L.featuresTitle}</h2>
            <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {L.features.map((f) => (
                <div key={f.t} className="rounded-3xl border border-line bg-surface p-6">
                  <span className="inline-flex size-11 items-center justify-center rounded-2xl bg-brand/10 text-brand"><Icon name={f.icon as IconName} /></span>
                  <h3 className="mt-4 text-lg font-bold">{f.t}</h3>
                  <p className="mt-2 text-muted">{f.d}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="mx-auto grid max-w-6xl items-center gap-12 px-4 py-20 md:grid-cols-2">
          <BookingMock />
          <div>
            <h2 className="font-display text-4xl font-extrabold">{L.showcaseTitle}</h2>
            <p className="mt-3 text-lg text-muted">{L.showcaseSub}</p>
            <ul className="mt-6 space-y-3">
              {L.showcasePoints.map((p) => (
                <li key={p} className="flex items-center gap-3">
                  <span className="inline-flex size-7 items-center justify-center rounded-full bg-brand/15 text-brand"><Icon name="check" size={16} /></span>{p}
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section id="pricing" className="scroll-mt-20 border-t border-line">
          <div className="mx-auto max-w-3xl px-4 py-20 text-center">
            <h2 className="font-display text-4xl font-extrabold">{L.pricingTitle}</h2>
            <div className="mt-10 grid gap-4 sm:grid-cols-2">
              <div className="rounded-3xl border border-line bg-surface p-6">
                <div className="text-muted">{L.pricingFree}</div>
                <div className="mt-2 font-display text-5xl font-extrabold">{L.pricingFreeValue}</div>
              </div>
              <div className="rounded-3xl border border-brand/40 bg-surface p-6">
                <div className="text-muted">{L.pricingAfter}</div>
                <div className="mt-2 font-display text-5xl font-extrabold text-brand">KES {price}<span className="text-lg font-semibold text-muted"> {L.perMonth}</span></div>
              </div>
            </div>
            <p className="mt-6 text-muted">{L.pricingStaff}</p>
            <p className="mt-1 text-muted">{L.pricingNoMoney}</p>
            <Link href="/signup" className={btn("primary", "mt-8 min-h-14 px-8 text-lg")}>{L.ctaPrimary}</Link>
          </div>
        </section>

        <section className="border-t border-line bg-surface/30">
          <div className="mx-auto max-w-3xl px-4 py-20">
            <h2 className="font-display text-4xl font-extrabold">{L.faqTitle}</h2>
            <div className="mt-8 divide-y divide-line rounded-3xl border border-line bg-surface">
              {L.faq.map((f) => (
                <details key={f.q} className="group p-5">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-lg font-semibold">
                    {f.q}<span className="text-brand transition group-open:rotate-45"><Icon name="plus" size={20} /></span>
                  </summary>
                  <p className="mt-3 text-muted">{f.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <section id="contact" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-20">
          <h2 className="font-display text-4xl font-extrabold">{L.contactTitle}</h2>
          <p className="mt-2 text-lg text-muted">{L.contactSub}</p>
          {c.placeholder ? <p className="mt-2 text-sm text-muted">{L.placeholderNote}</p> : null}
          <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {contacts.map((x) => {
              const inner = (
                <>
                  <span className="inline-flex size-10 items-center justify-center rounded-xl bg-brand/10 text-brand"><Icon name={x.icon} size={20} /></span>
                  <div className="mt-3 text-sm text-muted">{x.label}</div>
                  <div className="break-all font-semibold">{x.value}</div>
                </>
              );
              return x.href && !c.placeholder
                ? <a key={x.label} href={x.href} className="rounded-3xl border border-line bg-surface p-5 hover:border-brand/40">{inner}</a>
                : <div key={x.label} className="rounded-3xl border border-line bg-surface p-5">{inner}</div>;
            })}
          </div>
        </section>
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-4 py-8 text-sm text-muted sm:flex-row">
          <Logo />
          <div className="flex gap-5">
            <Link href="/guide" className="hover:text-ink">{s.home.guide}</Link>
            <Link href="/login" className="hover:text-ink">{L.signIn}</Link>
          </div>
          <span>© {new Date().getFullYear()} {L.footer}</span>
        </div>
      </footer>
    </div>
  );
}
