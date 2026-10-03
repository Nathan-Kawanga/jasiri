import { NextResponse, type NextRequest } from "next/server";
import { serverClient } from "@/lib/supabase/server";
import { respond, type Format, type Table } from "@/lib/export";
import { s } from "@/lib/strings";
import { displayPhone } from "@/lib/phone";
import { nairobiToday, dateTime, time } from "@/lib/format";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

type EarningRow = { display_code: string; shop_name: string; day: string; created_at: string; role: string; amount: number; client_first_name: string | null; verification: string };
type Earnings = { rows: EarningRow[]; verified_amount: number; verified_count: number; open_amount: number; open_count: number; voided_count: number };

export async function GET(req: NextRequest, ctx: RouteContext<"/api/export/[kind]">) {
  const { kind } = await ctx.params;
  const q = req.nextUrl.searchParams;
  const format = (["csv", "xlsx", "pdf"].includes(q.get("format") ?? "") ? q.get("format") : "csv") as Format;
  const from = DATE.test(q.get("from") ?? "") ? q.get("from")! : nairobiToday();
  const to = DATE.test(q.get("to") ?? "") ? q.get("to")! : from;
  const supabase = await serverClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not_signed_in" }, { status: 401 });
  const { data: me } = await supabase.rpc("my_profile");

  let table: Table;
  let name: string;

  if (kind === "earnings") {
    const { data, error } = await supabase.rpc("my_earnings", { p_from: from, p_to: to });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    const e = data as Earnings;
    table = {
      title: `${s.app.name} work record - ${me.full_name}`,
      subtitle: `${from} to ${to} · ${s.earnings.verified}: KES ${e.verified_amount} (${e.verified_count}) · ${s.earnings.open}: KES ${e.open_amount} (${e.open_count}) · ${s.earnings.voided}: ${e.voided_count}`,
      headers: ["Date", "Time", "Code", "Shop", "Work", "Client", "Amount (KES)", "Status"],
      rows: [...e.rows].reverse().map((r) => [r.day, time(r.created_at), r.display_code, r.shop_name,
        r.role === "barber" ? s.earnings.asBarber : s.earnings.asService, r.client_first_name ?? "", r.amount, s.code.verification[r.verification]]),
      footer: ["", "", "", "", "", s.earnings.verified, e.verified_amount, ""],
    };
    name = `jasiri-work-${from}-${to}`;
  } else if (kind === "clients") {
    const { data, error } = await supabase.rpc("my_client_book", { p_search: null });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    table = {
      title: `${s.clients.title} - ${me.full_name}`,
      headers: ["First name", "Phone", "Visits", "Last visit", "Total (KES)", "Due"],
      rows: (data as { first_name: string; phone: string; visits: number; last_visit: string | null; total_spent: number; due: boolean }[])
        .map((c) => [c.first_name, displayPhone(c.phone), c.visits, c.last_visit ? dateTime(c.last_visit) : "", c.total_spent, c.due ? "yes" : ""]),
    };
    name = "jasiri-client-book";
  } else if (kind === "payout") {
    const shop = q.get("shop") ?? "";
    const { data, error } = await supabase.rpc("payout_sheet", { p_shop: shop, p_day: from });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    const rows = (data as { rows: { name: string; role: string; paid_count: number; paid_amount: number; open_count: number; codes: { code: string }[] }[] }).rows;
    table = {
      title: `${s.manager.payoutTitle} - ${from}`,
      headers: [s.manager.person, "Work", s.manager.paidCodes, s.manager.earned + " (KES)", s.manager.openCodes, "Codes"],
      rows: rows.map((r) => [r.name, r.role === "barber" ? s.earnings.asBarber : s.earnings.asService, r.paid_count, r.paid_amount, r.open_count, r.codes.map((c) => c.code).join(" ")]),
      footer: ["Total", "", rows.reduce((a, r) => a + r.paid_count, 0), rows.reduce((a, r) => a + r.paid_amount, 0), "", ""],
    };
    name = `jasiri-payout-${from}`;
  } else if (kind === "usage") {
    const shop = q.get("shop");
    const { data, error } = shop
      ? await supabase.rpc("shop_usage", { p_shop: shop, p_from: from, p_to: to })
      : await supabase.rpc("platform_usage", { p_from: from, p_to: to });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    table = { title: `${s.manager.usageTitle} ${from} to ${to}`, headers: ["Metric", "Value"], rows: flatten(data) };
    name = `jasiri-usage-${from}-${to}`;
  } else {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return respond(table, format, name);
}

function flatten(v: unknown, prefix = ""): (string | number)[][] {
  if (v === null || typeof v !== "object") return [[prefix, (v as string | number) ?? ""]];
  if (Array.isArray(v)) return v.flatMap((x, i) => flatten(x, `${prefix}[${i + 1}]`));
  return Object.entries(v).flatMap(([k, x]) => flatten(x, prefix ? `${prefix}.${k}` : k));
}
