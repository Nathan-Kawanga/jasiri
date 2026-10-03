import "server-only";
import { headers } from "next/headers";
import { serviceClient } from "./supabase/server";

export async function clientIp(): Promise<string> {
  const h = await headers();
  return h.get("x-real-ip") ?? h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
}

// true = allowed. Counts are kept in the database so every server instance shares them.
export async function rateLimit(key: string, limit: number, windowSeconds: number): Promise<boolean> {
  const { data, error } = await serviceClient().rpc("hit_rate_limit", {
    p_key: key, p_limit: limit, p_window_seconds: windowSeconds,
  });
  if (error) throw new Error(error.message);
  return data === true;
}
