"use client";
import { useEffect, useRef, useState } from "react";

// Ids that showed up after the screen opened. They stay marked "new" for a while,
// the phone buzzes once, and onArrive gets the newest one.
export function useArrivals(ids: string[], onArrive?: (id: string) => void, keepMs = 15_000) {
  const seen = useRef<Set<string> | null>(null);
  const timers = useRef<number[]>([]);
  const arrive = useRef(onArrive);
  const [fresh, setFresh] = useState<string[]>([]);
  const key = ids.join(",");

  useEffect(() => { arrive.current = onArrive; });
  useEffect(() => () => timers.current.forEach((t) => clearTimeout(t)), []);

  useEffect(() => {
    const list = key ? key.split(",") : [];
    if (seen.current === null) { seen.current = new Set(list); return; }
    const added = list.filter((id) => !seen.current!.has(id));
    list.forEach((id) => seen.current!.add(id));
    if (!added.length) return;
    try { navigator.vibrate?.(200); } catch { /* not supported */ }
    setFresh((f) => [...f, ...added]);
    arrive.current?.(added[added.length - 1]);
    timers.current.push(window.setTimeout(() => setFresh((f) => f.filter((id) => !added.includes(id))), keepMs));
  }, [key, keepMs]);

  return fresh;
}
