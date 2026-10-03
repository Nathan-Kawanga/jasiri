import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { Icon } from "./icons";

const base =
  "inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl px-5 text-base font-semibold " +
  "transition duration-150 active:scale-[0.97] disabled:opacity-40 disabled:active:scale-100";

const variants = {
  primary: "gold-grad text-black shine hover:brightness-110",
  secondary: "border border-line bg-surface-2 text-ink hover:border-brand/60",
  ghost: "text-brand hover:text-ink",
  danger: "border border-red-500/40 bg-red-500/10 text-red-300 hover:bg-red-500/20",
  dangerSolid: "bg-red-500 text-white hover:bg-red-600",
  dark: "bg-surface-2 text-ink",
};
export type Variant = keyof typeof variants;

export function btn(variant: Variant = "primary", extra = "") {
  return `${base} ${variants[variant]} ${extra}`;
}

export function Button({ variant = "primary", className = "", ...props }: ComponentProps<"button"> & { variant?: Variant }) {
  return <button className={btn(variant, className)} {...props} />;
}

export function LinkButton({ variant = "primary", className = "", ...props }: ComponentProps<typeof Link> & { variant?: Variant }) {
  return <Link className={btn(variant, className)} {...props} />;
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-semibold text-muted">{label}</span>
      {children}
      {hint ? <span className="mt-1.5 block text-sm text-muted">{hint}</span> : null}
    </label>
  );
}

export const inputClass =
  "block min-h-13 w-full rounded-2xl border border-line bg-surface-2 px-4 text-lg text-ink " +
  "placeholder:text-zinc-500 focus:border-brand focus:outline-none focus:ring-4 focus:ring-brand/15";

export function Input(props: ComponentProps<"input">) {
  return <input {...props} className={`${inputClass} ${props.className ?? ""}`} />;
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-3xl border border-line bg-surface p-4 ${className}`}>{children}</div>;
}

export function Page({ title, back = "/", children, actions }: {
  title: string; back?: string | null; children: ReactNode; actions?: ReactNode;
}) {
  return (
    <div className="mx-auto w-full max-w-xl px-4 pb-20">
      <header className="no-print sticky top-0 z-10 -mx-4 mb-5 bg-paper/85 backdrop-blur-md">
        <div className="flex min-h-16 items-center gap-2 px-4">
          {back !== null ? (
            <Link href={back} aria-label="Back"
              className="-ml-1 inline-flex size-11 items-center justify-center rounded-full border border-line bg-surface text-ink active:scale-95">
              <Icon name="arrowLeft" size={20} />
            </Link>
          ) : null}
          <h1 className="flex-1 truncate text-2xl font-bold">{title}</h1>
          {actions}
        </div>
        <div className="pole h-1 opacity-80" />
      </header>
      {children}
    </div>
  );
}

export function Notice({ tone = "info", children }: { tone?: "info" | "warn" | "error" | "ok"; children: ReactNode }) {
  const tones = {
    info: "border-brand/30 bg-brand/10 text-amber-100",
    warn: "border-amber-400/40 bg-amber-400/10 text-amber-200",
    error: "border-red-500/40 bg-red-500/10 text-red-200",
    ok: "border-emerald-400/40 bg-emerald-400/10 text-emerald-200",
  };
  return <div role={tone === "error" ? "alert" : "status"} className={`rounded-2xl border p-3.5 text-base ${tones[tone]}`}>{children}</div>;
}

export function Badge({ children, tone = "gray" }: { children: ReactNode; tone?: "gray" | "green" | "amber" | "red" | "blue" }) {
  const tones = {
    gray: "bg-white/10 text-zinc-200",
    green: "bg-emerald-400/15 text-emerald-300",
    amber: "bg-amber-400/15 text-amber-300",
    red: "bg-red-500/15 text-red-300",
    blue: "bg-sky-400/15 text-sky-300",
  };
  return <span className={`inline-block rounded-full px-2.5 py-0.5 text-sm font-semibold ${tones[tone]}`}>{children}</span>;
}

export function Stat({ label, value, tone }: { label: string; value: ReactNode; tone?: "warn" | "gold" }) {
  const style = tone === "warn" ? "border-amber-400/40 bg-amber-400/10"
    : tone === "gold" ? "border-transparent gold-grad text-black" : "border-line bg-surface";
  return (
    <div className={`rounded-3xl border p-4 ${style}`}>
      <div className={`text-sm ${tone === "gold" ? "text-black/70" : "text-muted"}`}>{label}</div>
      <div className="font-display text-3xl font-bold tabular-nums">{value}</div>
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-3xl border border-dashed border-line py-8 text-center text-muted">{children}</p>;
}
