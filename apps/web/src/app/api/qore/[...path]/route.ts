import { NextResponse } from "next/server";

/**
 * QoreChain REST (LCD) proxy for in-browser Blindspot accounts.
 *  - GET  /api/qore/cosmos/... and /api/qore/qorechain/...  → read-only REST
 *  - POST /api/qore/cosmos/tx/v1beta1/txs                   → broadcast an already-signed tx
 * Nothing is signed server-side; this only avoids CORS and keeps the upstream swappable.
 */
const UPSTREAM = (process.env.QORE_REST_UPSTREAM || "https://api-testnet.qore.host").replace(/\/$/, "");
const READ_PREFIXES = ["cosmos/", "qorechain/"];

function target(path: string[], search: string) {
  const p = path.join("/");
  if (p.includes("..")) return null;
  return { p, url: `${UPSTREAM}/${p}${search}` };
}

export async function GET(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  const t = target(path, new URL(req.url).search);
  if (!t || !READ_PREFIXES.some((x) => t.p.startsWith(x))) {
    return NextResponse.json({ error: "path not allowed" }, { status: 403 });
  }
  const res = await fetch(t.url, { headers: { accept: "application/json" }, cache: "no-store" });
  return new NextResponse(res.body, {
    status: res.status,
    headers: { "content-type": res.headers.get("content-type") ?? "application/json", "cache-control": "no-store" },
  });
}

export async function POST(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  const t = target(path, "");
  if (!t || t.p !== "cosmos/tx/v1beta1/txs") return NextResponse.json({ error: "path not allowed" }, { status: 403 });
  const body = await req.text();
  if (body.length > 256 * 1024) return NextResponse.json({ error: "payload too large" }, { status: 413 });
  const res = await fetch(t.url, { method: "POST", headers: { "content-type": "application/json" }, body, cache: "no-store" });
  return new NextResponse(res.body, {
    status: res.status,
    headers: { "content-type": res.headers.get("content-type") ?? "application/json", "cache-control": "no-store" },
  });
}
