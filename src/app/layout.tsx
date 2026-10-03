import type { Metadata, Viewport } from "next";
import "./globals.css";
import { ConnectionBanner } from "@/components/connection-banner";
import { ServiceWorker } from "@/components/service-worker";
import { s } from "@/lib/strings";

export const metadata: Metadata = {
  title: s.app.name,
  description: s.app.tagline,
  appleWebApp: { capable: true, title: s.app.name, statusBarStyle: "default" },
  icons: { icon: "/icons/192", apple: "/icons/180" },
};

export const viewport: Viewport = {
  themeColor: "#0f5132",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body className="min-h-dvh antialiased">
        <ConnectionBanner />
        {children}
        <ServiceWorker />
      </body>
    </html>
  );
}
