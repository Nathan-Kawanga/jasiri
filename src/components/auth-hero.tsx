import { s } from "@/lib/strings";
import { Icon } from "./icons";

// Brand hero for the sign-in and sign-up screens.
export function AuthHero({ compact = false }: { compact?: boolean }) {
  return (
    <div className={compact ? "mb-6" : "mb-8"}>
      <div className="mb-6 flex items-center gap-3">
        <span className="gold-grad inline-flex size-12 items-center justify-center rounded-2xl text-black shine">
          <Icon name="scissors" size={26} />
        </span>
        <span className="font-display text-3xl font-extrabold gold-text">Jasiri</span>
      </div>
      {!compact ? (
        <>
          <h1 className="font-display text-5xl font-extrabold leading-[1.02]">{s.auth.heroTitle}</h1>
          <p className="mt-3 text-lg text-muted">{s.auth.heroSub}</p>
          <div className="no-scrollbar -mx-4 mt-5 flex gap-2 overflow-x-auto px-4">
            {[s.auth.pill1, s.auth.pill2, s.auth.pill3].map((t, i) => (
              <span key={t} className={`shrink-0 rounded-full border px-3 py-1.5 text-sm font-semibold ${
                ["border-amber-400/40 bg-amber-400/10 text-amber-200", "border-rose-400/40 bg-rose-400/10 text-rose-200", "border-sky-400/40 bg-sky-400/10 text-sky-200"][i]}`}>{t}</span>
            ))}
          </div>
        </>
      ) : null}
      <div className="pole mt-6 h-1.5 w-24 rounded-full" />
    </div>
  );
}
