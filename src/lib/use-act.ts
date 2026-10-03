"use client";
import { useCallback, useState } from "react";
import { act, ActionError } from "./action";

// Runs a database action with a pending flag and a friendly error code.
export function useAct() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(async <T,>(fn: string, args: Record<string, unknown> = {}, intent?: string) => {
    setPending(true);
    setError(null);
    try {
      return await act<T>(fn, args, intent);
    } catch (e) {
      setError(e instanceof ActionError ? e.code : "generic");
      return undefined;
    } finally {
      setPending(false);
    }
  }, []);
  return { run, pending, error, setError };
}
