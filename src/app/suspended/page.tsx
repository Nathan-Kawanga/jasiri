import { s } from "@/lib/strings";
import { Notice } from "@/components/ui";
import { signOut } from "@/app/auth-actions";

export default function Suspended() {
  return (
    <main className="mx-auto max-w-sm space-y-4 px-4 py-10">
      <Notice tone="error">{s.auth.suspended}</Notice>
      <form action={signOut}><button className="min-h-12 font-semibold text-brand">{s.app.signOut}</button></form>
    </main>
  );
}
