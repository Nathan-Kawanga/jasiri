import Link from "next/link";
import { Icon } from "./icons";

// Small brand header for the sign-in and sign-up screens; links back to the landing page.
export function AuthHero() {
  return (
    <Link href="/" className="mb-8 inline-flex items-center gap-2.5">
      <span className="gold-grad inline-flex size-10 items-center justify-center rounded-xl text-black"><Icon name="scissors" size={22} /></span>
      <span className="font-display text-2xl font-extrabold">Jasiri</span>
    </Link>
  );
}
