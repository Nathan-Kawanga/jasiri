import Link from "next/link";
import { guides } from "@/lib/guides";
import { Page } from "@/components/ui";

export default function GuideIndex() {
  return (
    <Page title="How to use Jasiri">
      <div className="grid gap-3">
        {Object.entries(guides).map(([k, g]) => (
          <Link key={k} href={`/guide/${k}`} className="flex min-h-16 items-center rounded-2xl border-2 border-line bg-white px-4 text-lg font-bold">{g.title}</Link>
        ))}
      </div>
    </Page>
  );
}
