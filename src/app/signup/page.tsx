import { s } from "@/lib/strings";
import { AuthHero } from "@/components/auth-hero";
import { SignupForm } from "./signup-form";

export default async function SignupPage({ searchParams }: PageProps<"/signup">) {
  const { next } = await searchParams;
  const site = (process.env.NEXT_PUBLIC_SITE_URL ?? "").replace(/^https?:\/\//, "");
  return (
    <main className="mesh min-h-dvh">
      <div className="mx-auto w-full max-w-sm px-4 py-8">
        <AuthHero />
        <div className="rounded-3xl border border-line bg-surface/80 p-5 backdrop-blur">
          <h1 className="mb-4 text-2xl font-bold">{s.auth.signUpTitle}</h1>
          <SignupForm siteUrl={site} next={typeof next === "string" ? next : "/"} />
        </div>
      </div>
    </main>
  );
}
