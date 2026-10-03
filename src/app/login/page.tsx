import { s } from "@/lib/strings";
import { Notice } from "@/components/ui";
import { LoginForm } from "./login-form";

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { expired, next } = await searchParams;
  return (
    <main className="mx-auto w-full max-w-sm px-4 py-10">
      <div className="mb-8 text-center">
        <div className="text-4xl font-black text-brand">{s.app.name}</div>
        <p className="text-muted">{s.app.tagline}</p>
      </div>
      <h1 className="mb-4 text-2xl font-bold">{s.auth.signInTitle}</h1>
      {expired ? <div className="mb-4"><Notice>{s.auth.sessionExpired}</Notice></div> : null}
      <LoginForm next={typeof next === "string" ? next : "/"} />
    </main>
  );
}
