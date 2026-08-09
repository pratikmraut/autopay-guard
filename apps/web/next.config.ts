import type { NextConfig } from "next";

import { securityHeaders } from "./src/lib/security-headers";

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  reactStrictMode: true,
  // Preserve the original request target for src/proxy.ts. Without this,
  // encoded dot segments can normalize into a different allowlisted BFF path.
  skipProxyUrlNormalize: true,
  skipTrailingSlashRedirect: true,
  transpilePackages: ["@autopay-guard/contracts"],
  experimental: {
    typedEnv: true,
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders(process.env.NODE_ENV),
      },
    ];
  },
};

export default nextConfig;
