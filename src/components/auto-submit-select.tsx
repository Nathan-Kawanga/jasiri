"use client";
import type { ComponentProps } from "react";

// A select that submits its form as soon as a choice is made.
export function AutoSubmitSelect(props: ComponentProps<"select">) {
  return <select {...props} onChange={(e) => e.currentTarget.form?.requestSubmit()} />;
}
