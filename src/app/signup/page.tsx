import { s } from "@/lib/strings";
import { SignupForm } from "./signup-form";

export default async function SignupPage({ searchParams }: PageProps<"/signup">) {
  const { next } = await searchParams;
  const site = (process.env.NEXT_PUBLIC_SITE_URL ?? "").replace(/^https?:\/\//, "");
  return (
    <main className="mx-auto w-full max-w-sm px-4 py-8">
      <div className="mb-6 text-3xl font-black text-brand">{s.app.name}</div>
      <h1 className="mb-4 text-2xl font-bold">{s.auth.signUpTitle}</h1>
      <SignupForm siteUrl={site} next={typeof next === "string" ? next : "/"} />
    </main>
  );
}
