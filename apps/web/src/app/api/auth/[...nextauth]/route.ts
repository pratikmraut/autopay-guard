import { handlers } from "@/auth";
import { getServerEnvironment } from "@/lib/env";
import type { NextRequest } from "next/server";

export async function GET(request: NextRequest) {
  getServerEnvironment();
  if (new URL(request.url).pathname === "/api/auth/session") {
    return new Response(null, {
      status: 404,
      headers: { "cache-control": "no-store" },
    });
  }
  return handlers.GET(request);
}

export async function POST(request: NextRequest) {
  getServerEnvironment();
  if (new URL(request.url).pathname === "/api/auth/session") {
    return new Response(null, {
      status: 404,
      headers: { "cache-control": "no-store" },
    });
  }
  return handlers.POST(request);
}
