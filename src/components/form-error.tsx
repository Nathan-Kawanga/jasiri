import { s, errorText } from "@/lib/strings";
import { Notice } from "./ui";
import type { FormState } from "@/app/auth-actions";

export function FormError({ state }: { state: FormState }) {
  if (!state?.error) return null;
  const text = state.error === "locked"
    ? (s.errors.locked as (n: number) => string)(state.minutes ?? 15)
    : errorText(state.error);
  return <Notice tone="error">{text}</Notice>;
}
