"use client";
import { useState } from "react";
import { s } from "@/lib/strings";
import { Button, type Variant } from "./ui";

export function CopyButton({ text, label = s.app.copy, variant = "secondary" }: { text: string; label?: string; variant?: Variant }) {
  const [done, setDone] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const t = document.createElement("textarea");
      t.value = text;
      document.body.appendChild(t);
      t.select();
      document.execCommand("copy");
      t.remove();
    }
    setDone(true);
    setTimeout(() => setDone(false), 2000);
  }
  return <Button type="button" variant={variant} onClick={copy}>{done ? s.app.copied : label}</Button>;
}
