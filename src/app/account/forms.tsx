"use client";
import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import { s } from "@/lib/strings";
import { useAct } from "@/lib/use-act";
import { changePin } from "@/app/auth-actions";
import type { Profile } from "@/lib/context";
import { Button, Card, Field, Input, Notice, inputClass } from "@/components/ui";
import { ErrorNote } from "@/components/error-note";
import { FormError } from "@/components/form-error";

export function ProfileForm({ profile, site }: { profile: Profile; site: string }) {
  const [name, setName] = useState(profile.full_name);
  const [barber, setBarber] = useState(profile.is_barber);
  const [handle, setHandle] = useState(profile.handle ?? "");
  const [about, setAbout] = useState(profile.about ?? "");
  const [saved, setSaved] = useState(false);
  const { run, pending, error } = useAct();
  const router = useRouter();

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaved(false);
    const r = await run("update_my_profile", {
      p_full_name: name, p_is_barber: barber, p_handle: barber ? handle : handle || null,
      p_about: about, p_slot_minutes: null,
    });
    if (r) { setSaved(true); router.refresh(); }
  }

  return (
    <Card>
      <form onSubmit={save} className="space-y-4">
        <ErrorNote code={error} />
        {saved ? <Notice tone="ok">{s.app.saved}</Notice> : null}
        <Field label={s.auth.fullName}><Input value={name} onChange={(e) => setName(e.target.value)} required /></Field>
        {profile.phone ? (
          <label className="flex min-h-12 items-center gap-3">
            <input type="checkbox" className="size-6 accent-brand" checked={barber} onChange={(e) => setBarber(e.target.checked)} />
            <span className="font-semibold">{s.auth.iAmBarber}</span>
          </label>
        ) : null}
        {barber ? <>
          <Field label={s.auth.handle} hint={<>{s.auth.handleHint} <b>{site}/b/{handle}</b></>}>
            <Input value={handle} required pattern="[a-z0-9][a-z0-9\-]{2,29}" autoCapitalize="none"
                   onChange={(e) => setHandle(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))} />
          </Field>
          <Field label={s.booking.about}>
            <textarea className={`${inputClass} min-h-24 py-2 text-base`} maxLength={400} value={about}
                      onChange={(e) => setAbout(e.target.value)} placeholder="Haircut 300 · Beard 100 · Kids 200" />
          </Field>
        </> : null}
        <Button disabled={pending} className="w-full">{s.app.save}</Button>
      </form>
    </Card>
  );
}

export function PinForm() {
  const [state, action, pending] = useActionState(changePin, undefined);
  return (
    <Card>
      <form action={action} className="space-y-4">
        <h2 className="text-lg font-bold">{s.auth.changePin}</h2>
        <FormError state={state} />
        {state?.ok ? <Notice tone="ok">{s.auth.pinChanged}</Notice> : null}
        <Field label={s.auth.currentPin}><Input name="current" type="password" inputMode="numeric" maxLength={6} required /></Field>
        <Field label={s.auth.newPin}><Input name="pin" type="password" inputMode="numeric" maxLength={6} required /></Field>
        <Field label={s.auth.pinAgain}><Input name="pin2" type="password" inputMode="numeric" maxLength={6} required /></Field>
        <Button variant="secondary" disabled={pending} className="w-full">{s.auth.changePin}</Button>
      </form>
    </Card>
  );
}

export function LeaveShop({ membershipId }: { membershipId: string }) {
  const { run, pending, error } = useAct();
  const router = useRouter();
  return (
    <div>
      <ErrorNote code={error} />
      <Button variant="danger" disabled={pending} onClick={async () => {
        if (confirm(s.shop.confirmLeave) && (await run("end_membership", { p_membership: membershipId }))) router.refresh();
      }}>{s.shop.leaveShop}</Button>
    </div>
  );
}
