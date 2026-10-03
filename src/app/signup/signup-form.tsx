"use client";
import { useActionState, useState } from "react";
import Link from "next/link";
import { signUp } from "@/app/auth-actions";
import { s } from "@/lib/strings";
import { Button, Field, Input } from "@/components/ui";
import { FormError } from "@/components/form-error";

export function SignupForm({ siteUrl, next }: { siteUrl: string; next: string }) {
  const [state, action, pending] = useActionState(signUp, undefined);
  const [mode, setMode] = useState<"phone" | "email">("phone");
  const [barber, setBarber] = useState(false);
  const [handle, setHandle] = useState("");

  return (
    <form action={action} className="space-y-4">
      <FormError state={state} />
      <input type="hidden" name="mode" value={mode} />
      <input type="hidden" name="next" value={next} />
      <Field label={s.auth.fullName}>
        <Input name="full_name" autoComplete="name" required minLength={2} />
      </Field>
      {mode === "phone" ? (
        <Field label={s.auth.phone}>
          <Input name="phone" type="tel" inputMode="tel" autoComplete="tel" required placeholder="0712 345 678" />
        </Field>
      ) : (
        <Field label={s.auth.email}>
          <Input name="email" type="email" autoComplete="email" required />
        </Field>
      )}
      <button type="button" className="min-h-12 text-left font-semibold text-brand"
              onClick={() => { setMode(mode === "phone" ? "email" : "phone"); setBarber(false); }}>
        {mode === "phone" ? s.auth.useEmail : s.auth.usePhone}
      </button>
      <Field label={s.auth.pin}>
        <Input name="pin" type="password" inputMode="numeric" pattern="\d{6}" maxLength={6} autoComplete="new-password" required />
      </Field>
      <Field label={s.auth.pinAgain}>
        <Input name="pin2" type="password" inputMode="numeric" pattern="\d{6}" maxLength={6} autoComplete="new-password" required />
      </Field>
      {mode === "phone" ? (
        <label className="flex min-h-12 items-start gap-3 rounded-xl border-2 border-line bg-white p-3">
          <input type="checkbox" name="is_barber" className="mt-1 size-6 accent-brand"
                 checked={barber} onChange={(e) => setBarber(e.target.checked)} />
          <span><span className="block font-semibold">{s.auth.iAmBarber}</span>
            <span className="text-sm text-muted">{s.auth.iAmBarberHint}</span></span>
        </label>
      ) : null}
      {barber ? (
        <Field label={s.auth.handle} hint={<>{s.auth.handleHint} <b>{siteUrl}/b/{handle || "your-name"}</b></>}>
          <Input name="handle" required pattern="[a-z0-9][a-z0-9\-]{2,29}" autoCapitalize="none"
                 value={handle} onChange={(e) => setHandle(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))} />
        </Field>
      ) : null}
      <Button type="submit" disabled={pending} className="w-full">{pending ? s.app.loading : s.auth.signUp}</Button>
      <Link href="/login" className="block min-h-12 py-3 text-center font-semibold text-brand">{s.auth.haveAccount}</Link>
    </form>
  );
}
