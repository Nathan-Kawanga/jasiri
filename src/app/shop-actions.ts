"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SHOP_COOKIE } from "@/lib/context";

export async function switchShop(form: FormData) {
  const id = String(form.get("shop_id") ?? "");
  (await cookies()).set(SHOP_COOKIE, id, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax", httpOnly: true });
  redirect("/");
}

export async function selectShop(id: string) {
  (await cookies()).set(SHOP_COOKIE, id, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax", httpOnly: true });
}
