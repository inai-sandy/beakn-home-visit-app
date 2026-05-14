import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Emits .next/standalone/server.js (self-contained Node bundle) so the
  // Docker runtime image can be minimal. See infra/docker/README.md.
  output: "standalone",
};

export default nextConfig;
