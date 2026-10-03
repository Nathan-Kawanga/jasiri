import { requireContext } from "@/lib/context";
import { s } from "@/lib/strings";
import { Page } from "@/components/ui";
import { NewShopForm } from "./form";

export default async function NewShop() {
  await requireContext();
  return <Page title={s.shop.createTitle}><NewShopForm /></Page>;
}
