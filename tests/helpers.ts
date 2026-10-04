import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import pg from "pg";
import { randomUUID } from "node:crypto";

export const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
export const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
export const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
export const DB = process.env.SUPABASE_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

export const service = createClient(URL, SERVICE, { auth: { persistSession: false } });
export const anon = () => createClient(URL, ANON, { auth: { persistSession: false } });

export type User = { id: string; phone: string; client: SupabaseClient; name: string };

let n = 0;
export function randomPhone() {
  n++;
  const tail = String(Math.floor(Math.random() * 1e6)).padStart(6, "0") + String(n % 100).padStart(2, "0");
  return `+2547${tail}`;
}

export async function newUser(opts: { barber?: boolean; name?: string; email?: string; role?: string } = {}): Promise<User> {
  const phone = randomPhone();
  const handle = opts.barber ? `t${phone.slice(-8)}${n}` : null;
  const name = opts.name ?? `Test ${n}`;
  const loginEmail = opts.email ?? `${phone.slice(1)}@phone.jasiri.app`;
  const { data, error } = await service.auth.admin.createUser({
    email: loginEmail, password: "123456", email_confirm: true,
    user_metadata: { full_name: name, phone: opts.email ? null : phone, contact_email: opts.email ?? null, is_barber: !!opts.barber, handle, signup_role: opts.role ?? (opts.barber ? "barber" : null) },
  });
  if (error) throw error;
  const client = anon();
  const { error: e2 } = await client.auth.signInWithPassword({ email: loginEmail, password: "123456" });
  if (e2) throw e2;
  return { id: data.user.id, phone, client, name };
}

// Calls a write function with a fresh request id (or the given one). Throws the error code.
export async function call<T = any>(u: User | SupabaseClient, fn: string, args: Record<string, unknown> = {}, requestId: string = randomUUID()): Promise<T> {
  const c = "client" in u ? u.client : u;
  const { data, error } = await c.rpc(fn, { p_request: requestId, ...args });
  if (error) throw new Error(error.message);
  return data as T;
}

export async function read<T = any>(u: User | SupabaseClient, fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const c = "client" in u ? u.client : u;
  const { data, error } = await c.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
}

export async function errorOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    return (e as Error).message;
  }
  return "no error";
}

export type Shop = { id: string; joinCode: string; manager: User; barber: User; staff: User; cashier: User };

// A shop with a manager who is also a barber, a second barber, service staff on duty and a cashier.
export async function newShop(): Promise<Shop> {
  const manager = await newUser({ barber: true, name: "Manager Barber" });
  const barber = await newUser({ barber: true, name: "Second Barber" });
  const staff = await newUser({ name: "Service Lady" });
  const cashier = await newUser({ name: "Cashier", email: `cashier${randomUUID().slice(0, 8)}@test.jasiri` });
  const { shop_id } = await call(manager, "create_shop", { p_name: "Test Shop", p_area: "Test Area" });
  const shops = await read(manager, "my_shops");
  const joinCode = shops.find((s: any) => s.shop_id === shop_id).join_code;
  for (const [u, roles] of [[barber, ["barber"]], [staff, ["service_staff"]], [cashier, ["cashier"]]] as const) {
    const { membership_id } = await call(u, "request_join", { p_code: joinCode });
    await call(manager, "decide_join", { p_membership: membership_id, p_approve: true, p_roles: roles });
  }
  await call(staff, "set_on_duty", { p_shop: shop_id, p_on: true });
  return { id: shop_id, joinCode, manager, barber, staff, cashier };
}

export async function sql<T = any>(text: string, args: unknown[] = []): Promise<T[]> {
  const c = new pg.Client({ connectionString: DB });
  await c.connect();
  try {
    return (await c.query(text, args)).rows as T[];
  } finally {
    await c.end();
  }
}

// Creates and confirms a code for an anonymous client. Returns the code id.
export async function openCode(shop: Shop, barber: User = shop.barber, amount = 300): Promise<string> {
  const c = await call(barber, "create_code", { p_shop: shop.id, p_amount: amount, p_anonymous: true });
  await call(barber, "confirm_code", { p_code: c.id });
  return c.id;
}
