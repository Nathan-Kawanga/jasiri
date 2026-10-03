"use client";
import { useSyncExternalStore } from "react";
import { connection } from "@/lib/connection";
import { s } from "@/lib/strings";

export function ConnectionBanner() {
  const offline = useSyncExternalStore(connection.subscribe, connection.isOffline, () => false);
  if (!offline) return null;
  return (
    <div role="alert" className="no-print sticky top-0 z-50 bg-red-700 px-4 py-2 text-center text-base font-semibold text-white">
      {s.app.noConnection}
    </div>
  );
}
