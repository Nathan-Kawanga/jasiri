import { ImageResponse } from "next/og";

export const dynamic = "force-static";
export function generateStaticParams() {
  return [{ size: "192" }, { size: "512" }, { size: "180" }];
}

export async function GET(_: Request, ctx: RouteContext<"/icons/[size]">) {
  const n = Number((await ctx.params).size) || 192;
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#0f5132", color: "white", fontSize: n * 0.62, fontWeight: 900 }}>
        J
      </div>
    ),
    { width: n, height: n },
  );
}
