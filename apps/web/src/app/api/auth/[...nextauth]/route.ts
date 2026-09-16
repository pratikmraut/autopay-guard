import { handlers } from "@/auth";
import { getServerEnvironment } from "@/lib/env";
import { isPublicAuthRoute } from "@/lib/public-auth-route";
import type { NextRequest } from "next/server";

export async function GET(request: NextRequest) {
  getServerEnvironment();
  if (!isPublicAuthRoute("GET", new URL(request.url).pathname)) {
    return new Response(null, {
      status: 404,
      headers: { "cache-control": "no-store" },
    });
  }
  return handlers.GET(request);
}

export async function POST(request: NextRequest) {
  getServerEnvironment();
  if (!isPublicAuthRoute("POST", new URL(request.url).pathname)) {
    return new Response(null, {
      status: 404,
      headers: { "cache-control": "no-store" },
    });
  }
  return handlers.POST(request);
}
