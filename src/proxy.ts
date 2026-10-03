import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

const PUBLIC = [/^\/login/, /^\/signup/, /^\/b\//, /^\/suspended/, /^\/guide/];
const SESSION_DAYS = 30;

// Refreshes the session cookie on every request, sends signed-out people to /login,
// and ends sessions older than 30 days since the PIN was entered.
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (list) => {
          list.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          list.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    },
  );

  const path = request.nextUrl.pathname;
  const isPublic = PUBLIC.some((re) => re.test(path));
  const { data: { user } } = await supabase.auth.getUser();

  if (user) {
    const { data: { session } } = await supabase.auth.getSession();
    const signedInAt = pinTime(session?.access_token);
    if (signedInAt && Date.now() / 1000 - signedInAt > SESSION_DAYS * 86400) {
      await supabase.auth.signOut({ scope: "local" });
      return redirectTo(request, "/login?expired=1", response);
    }
  }

  if (!user && !isPublic) {
    const next = path === "/" ? "" : `?next=${encodeURIComponent(path + request.nextUrl.search)}`;
    return redirectTo(request, `/login${next}`, response);
  }
  return response;
}

function pinTime(token?: string): number | null {
  if (!token) return null;
  try {
    const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    const amr = (payload.amr ?? []) as { method: string; timestamp: number }[];
    const pw = amr.find((a) => a.method === "password");
    return pw?.timestamp ?? null;
  } catch {
    return null;
  }
}

function redirectTo(request: NextRequest, to: string, carry: NextResponse) {
  const res = NextResponse.redirect(new URL(to, request.url));
  carry.cookies.getAll().forEach((c) => res.cookies.set(c));
  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icons/|manifest.webmanifest|sw.js|robots.txt).*)"],
};
