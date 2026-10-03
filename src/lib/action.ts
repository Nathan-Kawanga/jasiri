"use client";
import { browserClient } from "./supabase/browser";
import { uuid } from "./ids";
import { connection } from "./connection";

export class ActionError extends Error {
  constructor(public code: string) {
    super(code);
  }
}

// One request id per user intent. A double tap or a retry on a bad connection
// sends the same id, and the database returns the first result instead of acting twice.
const inFlight = new Map<string, string>();

function isNetworkError(e: { code?: string; message?: string }) {
  return !e.code && /fetch|network|load failed|timed out/i.test(e.message ?? "");
}

const backoff = (attempt: number) => Math.min(1000 * 2 ** attempt, 15000);

export async function act<T = unknown>(
  fn: string,
  args: Record<string, unknown> = {},
  intent?: string,
): Promise<T> {
  const key = intent ?? `${fn}:${JSON.stringify(args)}`;
  let requestId = inFlight.get(key);
  if (!requestId) {
    requestId = uuid();
    inFlight.set(key, requestId);
  }
  for (let attempt = 0; ; attempt++) {
    const { data, error } = await browserClient().rpc(fn, { p_request: requestId, ...args });
    if (!error) {
      inFlight.delete(key);
      connection.ok();
      return data as T;
    }
    if (isNetworkError(error) && attempt < 40) {
      connection.down();
      await connection.waitOnline(backoff(attempt));
      continue;
    }
    inFlight.delete(key);
    throw new ActionError(error.message);
  }
}

// Read through a database function, retrying while offline.
export async function read<T = unknown>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const { data, error } = await browserClient().rpc(fn, args);
    if (!error) {
      connection.ok();
      return data as T;
    }
    if (isNetworkError(error) && attempt < 40) {
      connection.down();
      await connection.waitOnline(backoff(attempt));
      continue;
    }
    throw new ActionError(error.message);
  }
}
