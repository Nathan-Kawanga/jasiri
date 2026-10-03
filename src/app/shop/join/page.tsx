import { requireContext } from "@/lib/context";
import { s } from "@/lib/strings";
import { Page } from "@/components/ui";
import { JoinForm } from "./form";

export default async function JoinShop({ searchParams }: PageProps<"/shop/join">) {
  await requireContext();
  const { code } = await searchParams;
  return <Page title={s.shop.joinTitle}><JoinForm initialCode={typeof code === "string" ? code : ""} /></Page>;
}
