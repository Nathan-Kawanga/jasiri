"use client";
import { useActionState, useState } from "react";
import Link from "next/link";
import { signUp } from "@/app/auth-actions";
import { s } from "@/lib/strings";
import { Button, Field, Input, Notice } from "@/components/ui";
import { Icon, type IconName } from "@/components/icons";
import { FormError } from "@/components/form-error";

type Role = "barber" | "service_staff" | "cashier" | "manager";
const ROLES: { id: Role; label: string; hint: string; icon: IconName }[] = [
  { id: "barber", label: s.auth.roleBarber, hint: s.auth.roleBarberHint, icon: "scissors" },
  { id: "service_staff", label: s.auth.roleService, hint: s.auth.roleServiceHint, icon: "sparkles" },
  { id: "cashier", label: s.auth.roleCashier, hint: s.auth.roleCashierHint, icon: "cash" },
  { id: "manager", label: s.auth.roleManager, hint: s.auth.roleManagerHint, icon: "store" },
];

export function SignupForm({ siteUrl, next }: { siteUrl: string; next: string }) {
  const [state, action, pending] = useActionState(signUp, undefined);
  const [role, setRole] = useState<Role | null>(null);
  const [mode, setMode] = useState<"phone" | "email">("phone");
  const [handle, setHandle] = useState("");
  const barber = role === "barber";

  return (
    <form action={action} className="space-y-4">
      <FormError state={state} />
      <input type="hidden" name="mode" value={barber ? "phone" : mode} />
      <input type="hidden" name="next" value={next} />
      <input type="hidden" name="role" value={role ?? ""} />

      <fieldset className="space-y-2">
        <legend className="mb-1.5 text-sm font-semibold text-muted">{s.auth.whatDoYouDo}</legend>
        {ROLES.map((r) => (
          <button type="button" key={r.id} onClick={() => setRole(r.id)} aria-pressed={role === r.id}
            className={`flex w-full items-center gap-3 rounded-2xl border p-3 text-left transition ${
              role === r.id ? "border-brand bg-brand/10" : "border-line bg-surface-2"}`}>
            <span className={`inline-flex size-10 shrink-0 items-center justify-center rounded-xl ${role === r.id ? "gold-grad text-black" : "bg-brand/10 text-brand"}`}>
              <Icon name={r.icon} size={20} />
            </span>
            <span><span className="block font-semibold">{r.label}</span><span className="text-sm text-muted">{r.hint}</span></span>
          </button>
        ))}
        <p className="text-xs text-muted">{s.auth.rolesNote}</p>
      </fieldset>

      {role ? <>
        <Field label={s.auth.fullName}>
          <Input name="full_name" autoComplete="name" required minLength={2} />
        </Field>
        {mode === "phone" || barber ? (
          <Field label={s.auth.phone}>
            <Input name="phone" type="tel" inputMode="tel" autoComplete="tel" required placeholder="0712 345 678" />
          </Field>
        ) : (
          <Field label={s.auth.email}>
            <Input name="email" type="email" autoComplete="email" required />
          </Field>
        )}
        {role === "cashier" && mode === "phone" ? <Notice>{s.auth.cashierEmailTip}</Notice> : null}
        {!barber ? (
          <button type="button" className="min-h-12 text-left font-semibold text-brand"
                  onClick={() => setMode(mode === "phone" ? "email" : "phone")}>
            {mode === "phone" ? s.auth.useEmail : s.auth.usePhone}
          </button>
        ) : null}
        {barber ? (
          <Field label={s.auth.handle} hint={<>{s.auth.handleHint} <b>{siteUrl}/b/{handle || "your-name"}</b></>}>
            <Input name="handle" required pattern="[a-z0-9][a-z0-9\-]{2,29}" autoCapitalize="none"
                   value={handle} onChange={(e) => setHandle(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))} />
          </Field>
        ) : null}
        <Field label={s.auth.pin}>
          <Input name="pin" type="password" inputMode="numeric" pattern="\d{6}" maxLength={6} autoComplete="new-password" required />
        </Field>
        <Field label={s.auth.pinAgain}>
          <Input name="pin2" type="password" inputMode="numeric" pattern="\d{6}" maxLength={6} autoComplete="new-password" required />
        </Field>
        <Button type="submit" disabled={pending} className="w-full">{pending ? s.app.loading : s.auth.signUp}</Button>
      </> : null}
      <Link href="/login" className="block min-h-12 py-3 text-center font-semibold text-brand">{s.auth.haveAccount}</Link>
    </form>
  );
}
