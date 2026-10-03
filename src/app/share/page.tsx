import QRCode from "qrcode";
import { requireBarber } from "@/lib/context";
import { s } from "@/lib/strings";
import { Card, Notice, Page, LinkButton } from "@/components/ui";
import { CopyButton } from "@/components/copy-button";
import { PrintButton } from "@/components/print-button";

export default async function SharePage() {
  const { profile } = await requireBarber();
  const link = `${process.env.NEXT_PUBLIC_SITE_URL}/b/${profile.handle}`;
  const reply = s.booking.quickReplyText(link);
  const svg = await QRCode.toString(link, { type: "svg", margin: 1, errorCorrectionLevel: "M" });
  return (
    <Page title={s.booking.shareTitle}>
      <div className="space-y-5">
        <Card className="no-print space-y-3">
          <div className="break-all text-lg font-bold text-brand">{link}</div>
          <div className="grid grid-cols-2 gap-2">
            <CopyButton text={link} label={s.booking.copyLink} variant="primary" />
            <LinkButton href={`/b/${profile.handle}`} variant="secondary">↗</LinkButton>
          </div>
        </Card>
        <Card className="no-print space-y-3">
          <div className="font-bold">{s.booking.quickReply}</div>
          <p className="rounded-xl bg-paper p-3">{reply}</p>
          <CopyButton text={reply} />
          <Notice>{s.booking.quickReplyHint}</Notice>
        </Card>
        <Card className="space-y-3 text-center">
          <div className="no-print font-bold">{s.booking.qr}</div>
          <div className="text-3xl font-black">{profile.full_name}</div>
          <div className="text-xl">{s.booking.scanToBook}</div>
          <div className="mx-auto w-full max-w-xs" dangerouslySetInnerHTML={{ __html: svg }} />
          <div className="break-all font-semibold">{link}</div>
          <PrintButton label={s.booking.printQr} />
        </Card>
      </div>
    </Page>
  );
}
