"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { browserClient } from "./supabase/browser";
import { read } from "./action";

// Loads data through a database function and keeps it fresh: realtime changes on
// the shop's codes trigger a reload, with a fallback refresh every 10 seconds.
export function useLive<T>(fn: string, args: Record<string, unknown>, shopId: string, initial: T) {
  const [data, setData] = useState<T>(initial);
  const argsKey = JSON.stringify(args);
  const busy = useRef(false);

  const reload = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      setData(await read<T>(fn, JSON.parse(argsKey)));
    } catch {
      // keep showing the last data; the banner shows the connection state
    } finally {
      busy.current = false;
    }
  }, [fn, argsKey]);

  useEffect(() => {
    const supabase = browserClient();
    const channel = supabase
      .channel(`codes:${shopId}:${fn}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "codes", filter: `shop_id=eq.${shopId}` }, () => reload())
      .on("postgres_changes", { event: "*", schema: "public", table: "code_service_lines", filter: `shop_id=eq.${shopId}` }, () => reload())
      .subscribe();
    const timer = setInterval(reload, 10_000);
    const onFocus = () => reload();
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onFocus);
      supabase.removeChannel(channel);
    };
  }, [shopId, fn, reload]);

  return { data, reload };
}
