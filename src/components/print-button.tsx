"use client";
import { Button } from "./ui";

export function PrintButton({ label }: { label: string }) {
  return <Button className="no-print w-full" variant="secondary" onClick={() => window.print()}>{label}</Button>;
}
