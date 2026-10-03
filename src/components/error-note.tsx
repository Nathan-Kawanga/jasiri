import { errorText } from "@/lib/strings";
import { Notice } from "./ui";

export function ErrorNote({ code }: { code: string | null | undefined }) {
  if (!code) return null;
  return <Notice tone="error">{errorText(code)}</Notice>;
}
