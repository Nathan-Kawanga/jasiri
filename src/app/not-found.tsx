import Link from "next/link";
import { s } from "@/lib/strings";

export default function NotFound() {
  return (
    <main className="mx-auto max-w-sm px-4 py-16 text-center">
      <div className="text-5xl font-black text-brand">404</div>
      <p className="my-4 text-lg">{s.booking.notFound}</p>
      <Link href="/" className="font-semibold text-brand">{s.app.home}</Link>
    </main>
  );
}
