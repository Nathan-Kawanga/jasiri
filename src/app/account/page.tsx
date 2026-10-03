import { requireContext } from "@/lib/context";
import { s } from "@/lib/strings";
import { displayPhone } from "@/lib/phone";
import { Card, Page } from "@/components/ui";
import { signOut } from "@/app/auth-actions";
import { ProfileForm, PinForm, LeaveShop } from "./forms";

export default async function Account() {
  const { profile, shops } = await requireContext();
  return (
    <Page title={s.home.account}>
      <div className="space-y-6">
        <Card>
          <div className="text-lg font-bold">{profile.full_name}</div>
          <div className="text-muted">{profile.phone ? displayPhone(profile.phone) : profile.email}</div>
        </Card>
        <ProfileForm profile={profile} site={(process.env.NEXT_PUBLIC_SITE_URL ?? "").replace(/^https?:\/\//, "")} />
        <section className="space-y-2">
          <h2 className="text-lg font-bold">{s.shop.members}</h2>
          {shops.map((m) => (
            <Card key={m.membership_id} className="flex items-center justify-between gap-2">
              <div>
                <div className="font-bold">{m.name}</div>
                <div className="text-sm text-muted">{m.status === "pending" ? s.home.pending : m.roles.map((r) => s.shop.role[r]).join(", ")}</div>
              </div>
              <LeaveShop membershipId={m.membership_id} />
            </Card>
          ))}
        </section>
        <PinForm />
        <form action={signOut}><button className="min-h-12 w-full rounded-xl border-2 border-line font-semibold">{s.app.signOut}</button></form>
      </div>
    </Page>
  );
}
