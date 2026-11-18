import { NextResponse } from "next/server";

/**
 * Read-only JSON-RPC proxy to the chain's RPC. The browser talks to /api/rpc on our own
 * origin, so public RPCs without CORS headers still work, and the upstream URL can be
 * swapped (or keyed) server-side via RPC_UPSTREAM. Writes never pass through here —
 * transactions go from the user's wallet to its own RPC.
 */

const UPSTREAM = process.env.RPC_UPSTREAM || process.env.NEXT_PUBLIC_RPC_URL || "https://evm-testnet.qore.host";

const ALLOWED = new Set([
  "eth_chainId",
  "net_version",
  "eth_blockNumber",
  "eth_call",
  "eth_estimateGas",
  "eth_getLogs",
  "eth_getBalance",
  "eth_getCode",
  "eth_getBlockByNumber",
  "eth_getBlockByHash",
  "eth_getTransactionByHash",
  "eth_getTransactionReceipt",
  "eth_getTransactionCount",
  "eth_gasPrice",
  "eth_maxPriorityFeePerGas",
  "eth_feeHistory",
]);

type Req = { jsonrpc: "2.0"; id: number | string | null; method: string; params?: unknown[] };

export async function POST(req: Request) {
  const text = await req.text();
  if (text.length > 256 * 1024) return NextResponse.json({ error: "payload too large" }, { status: 413 });

  let body: Req | Req[];
  try {
    body = JSON.parse(text);
  } catch {
    return NextResponse.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } }, { status: 400 });
  }
  const calls = Array.isArray(body) ? body : [body];
  if (calls.length === 0 || calls.length > 50) {
    return NextResponse.json({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "batch size 1–50" } }, { status: 400 });
  }
  const denied = calls.find((c) => !c || typeof c.method !== "string" || !ALLOWED.has(c.method));
  if (denied) {
    return NextResponse.json(
      { jsonrpc: "2.0", id: denied?.id ?? null, error: { code: -32601, message: `method not allowed: ${denied?.method}` } },
      { status: 403 },
    );
  }

  const upstream = await fetch(UPSTREAM, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: text,
    cache: "no-store",
  });
  return new NextResponse(upstream.body, {
    status: upstream.status,
    headers: { "content-type": upstream.headers.get("content-type") ?? "application/json", "cache-control": "no-store" },
  });
}
