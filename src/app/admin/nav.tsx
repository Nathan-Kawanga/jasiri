import Link from "next/link";
import { s } from "@/lib/strings";

export function AdminNav({ at }: { at: string }) {
  const items = [["/admin", s.admin.usage], ["/admin/users", s.admin.users], ["/admin/shops", s.admin.shops], ["/admin/clients", s.admin.clients], ["/admin/settings", s.admin.settings]];
  return (
    <nav className="-mx-4 mb-4 flex gap-2 overflow-x-auto px-4 pb-1">
      {items.map(([href, label]) => (
        <Link key={href} href={href} className={`min-h-12 shrink-0 rounded-full px-4 py-3 text-sm font-semibold ${at === href ? "bg-brand text-white" : "border-2 border-line bg-white"}`}>{label}</Link>
      ))}
    </nav>
  );
}
