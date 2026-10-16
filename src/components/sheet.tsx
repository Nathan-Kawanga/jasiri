"use client";
import { useEffect, type ReactNode } from "react";

// Full-screen panel over whatever page it is opened from (home, cashier, queue).
export function Sheet({ children }: { children: ReactNode }) {
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);
  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 overflow-y-auto bg-paper">
      <div className="mx-auto w-full max-w-xl px-4 pb-20 pt-4">{children}</div>
    </div>
  );
}
