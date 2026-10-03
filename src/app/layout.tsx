import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";
import { ConnectionBanner } from "@/components/connection-banner";
import { ServiceWorker } from "@/components/service-worker";
import { s } from "@/lib/strings";

const head = Bricolage_Grotesque({ subsets: ["latin"], variable: "--font-head", display: "swap", weight: ["600", "700", "800"] });
const body = Plus_Jakarta_Sans({ subsets: ["latin"], variable: "--font-body", display: "swap", weight: ["400", "500", "600", "700"] });

export const metadata: Metadata = {
  title: s.app.name,
  description: s.app.tagline,
  appleWebApp: { capable: true, title: s.app.name, statusBarStyle: "black-translucent" },
  icons: { icon: "/icons/192", apple: "/icons/180" },
};

export const viewport: Viewport = {
  themeColor: "#09090c",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${head.variable} ${body.variable}`}>
      <body className="min-h-dvh antialiased">
        <ConnectionBanner />
        {children}
        <ServiceWorker />
      </body>
    </html>
  );
}
