"use client";
import { useActionState } from "react";
import Link from "next/link";
import { signIn } from "@/app/auth-actions";
import { s } from "@/lib/strings";
import { Button, Field, Input } from "@/components/ui";
import { FormError } from "@/components/form-error";

export function LoginForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState(signIn, undefined);
  return (
    <form action={action} className="space-y-4">
      <FormError state={state} />
      <input type="hidden" name="next" value={next} />
      <Field label={s.auth.phoneOrEmail} hint={s.auth.phoneOrEmailHint}>
        <Input name="identifier" autoComplete="username" required placeholder="0712 345 678" />
      </Field>
      <Field label={s.auth.pin}>
        <Input name="pin" type="password" inputMode="numeric" pattern="\d{6}" maxLength={6}
               autoComplete="current-password" required />
      </Field>
      <Button type="submit" disabled={pending} className="w-full">{pending ? s.app.loading : s.auth.signIn}</Button>
      <p className="text-center text-sm text-muted">{s.auth.forgotPin}</p>
      <Link href={next !== "/" ? `/signup?next=${encodeURIComponent(next)}` : "/signup"} className="block min-h-12 py-3 text-center font-semibold text-brand">{s.auth.noAccount}</Link>
    </form>
  );
}
