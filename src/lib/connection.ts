"use client";
// Tracks whether the last request reached the server, for the "No connection" banner.
type Listener = () => void;
let offline = false;
const listeners = new Set<Listener>();

function set(v: boolean) {
  if (offline === v) return;
  offline = v;
  listeners.forEach((l) => l());
}

export const connection = {
  subscribe(l: Listener) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  isOffline: () => offline,
  down: () => set(true),
  ok: () => set(false),
  // Resolves when the browser says it is back online, or after the delay.
  waitOnline(delayMs: number) {
    return new Promise<void>((resolve) => {
      const t = setTimeout(done, delayMs);
      function done() {
        clearTimeout(t);
        window.removeEventListener("online", done);
        resolve();
      }
      window.addEventListener("online", done);
    });
  },
};

if (typeof window !== "undefined") {
  window.addEventListener("offline", () => set(true));
}
