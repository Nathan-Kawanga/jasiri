import { s } from "@/lib/strings";
import { Notice } from "@/components/ui";
import { AuthHero } from "@/components/auth-hero";
import { LoginForm } from "./login-form";

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { expired, next } = await searchParams;
  return (
    <main className="mesh min-h-dvh">
      <div className="mx-auto w-full max-w-sm px-4 py-10">
        <AuthHero />
        {expired ? <div className="mb-4"><Notice>{s.auth.sessionExpired}</Notice></div> : null}
        <div className="rounded-3xl border border-line bg-surface/80 p-5 backdrop-blur">
          <h2 className="mb-4 text-2xl font-bold">{s.auth.signInTitle}</h2>
          <LoginForm next={typeof next === "string" ? next : "/"} />
        </div>
      </div>
    </main>
  );
}
