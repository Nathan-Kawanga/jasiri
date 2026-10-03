import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

const base =
  "inline-flex min-h-12 items-center justify-center gap-2 rounded-xl px-4 text-base font-semibold " +
  "transition active:scale-[0.98] disabled:opacity-50 disabled:active:scale-100";

const variants = {
  primary: "bg-brand text-white hover:bg-brand-dark",
  secondary: "border-2 border-brand bg-white text-brand",
  ghost: "text-brand underline-offset-4 hover:underline",
  danger: "border-2 border-red-700 bg-white text-red-700",
  dangerSolid: "bg-red-700 text-white",
  dark: "bg-ink text-white",
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
      <span className="mb-1 block text-sm font-semibold text-ink">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-sm text-muted">{hint}</span> : null}
    </label>
  );
}

export const inputClass =
  "block min-h-12 w-full rounded-xl border-2 border-line bg-white px-3 text-lg text-ink " +
  "placeholder:text-gray-400 focus:border-brand focus:outline-none";

export function Input(props: ComponentProps<"input">) {
  return <input {...props} className={`${inputClass} ${props.className ?? ""}`} />;
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-2xl border border-line bg-white p-4 ${className}`}>{children}</div>;
}

export function Page({ title, back = "/", children, actions }: {
  title: string; back?: string | null; children: ReactNode; actions?: ReactNode;
}) {
  return (
    <div className="mx-auto w-full max-w-xl px-4 pb-16">
      <header className="no-print sticky top-0 z-10 -mx-4 mb-4 flex min-h-14 items-center gap-2 border-b border-line bg-paper/95 px-4 backdrop-blur">
        {back !== null ? (
          <Link href={back} className="-ml-2 inline-flex min-h-12 min-w-12 items-center justify-center text-2xl text-brand" aria-label="Back">
            ←
          </Link>
        ) : null}
        <h1 className="flex-1 truncate text-xl font-bold">{title}</h1>
        {actions}
      </header>
      {children}
    </div>
  );
}

export function Notice({ tone = "info", children }: { tone?: "info" | "warn" | "error" | "ok"; children: ReactNode }) {
  const tones = {
    info: "border-brand bg-brand-soft text-brand-dark",
    warn: "border-amber-600 bg-amber-50 text-amber-900",
    error: "border-red-700 bg-red-50 text-red-800",
    ok: "border-green-700 bg-green-50 text-green-900",
  };
  return <div role={tone === "error" ? "alert" : "status"} className={`rounded-xl border-l-4 p-3 text-base ${tones[tone]}`}>{children}</div>;
}

export function Badge({ children, tone = "gray" }: { children: ReactNode; tone?: "gray" | "green" | "amber" | "red" | "blue" }) {
  const tones = {
    gray: "bg-gray-100 text-gray-800",
    green: "bg-green-100 text-green-900",
    amber: "bg-amber-100 text-amber-900",
    red: "bg-red-100 text-red-800",
    blue: "bg-sky-100 text-sky-900",
  };
  return <span className={`inline-block rounded-full px-2 py-0.5 text-sm font-semibold ${tones[tone]}`}>{children}</span>;
}

export function Stat({ label, value, tone }: { label: string; value: ReactNode; tone?: "warn" }) {
  return (
    <div className={`rounded-xl border p-3 ${tone === "warn" ? "border-amber-500 bg-amber-50" : "border-line bg-white"}`}>
      <div className="text-sm text-muted">{label}</div>
      <div className="text-2xl font-bold tabular-nums">{value}</div>
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="py-6 text-center text-muted">{children}</p>;
}
