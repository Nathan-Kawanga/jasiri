import { notFound } from "next/navigation";
import { guides } from "@/lib/guides";
import { Card, Page } from "@/components/ui";
import { PrintButton } from "@/components/print-button";

export function generateStaticParams() {
  return Object.keys(guides).map((role) => ({ role }));
}

export default async function GuidePage({ params }: PageProps<"/guide/[role]">) {
  const g = guides[(await params).role];
  if (!g) notFound();
  return (
    <Page title={`Guide: ${g.title}`} back="/guide">
      <div className="space-y-4">
        <p className="text-lg">{g.who}</p>
        {g.steps.map((st) => (
          <Card key={st.h}><div className="text-lg font-bold">{st.h}</div><p className="mt-1">{st.p}</p></Card>
        ))}
        <Card className="border-brand bg-brand-soft">
          <ul className="list-disc space-y-1 pl-5">{g.rules.map((r) => <li key={r}>{r}</li>)}</ul>
        </Card>
        <PrintButton label="Print" />
      </div>
    </Page>
  );
}
