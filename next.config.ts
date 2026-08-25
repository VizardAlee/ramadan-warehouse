import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  outputFileTracingRoot: process.cwd(),
  // Next 16's CLI configuration capture can close before its stdout stream is
  // complete under the local Node 20 build runtime. The documented compiler
  // API path performs the same production type check without that race.
  experimental: { useTypeScriptCli: false },
};

export default nextConfig;
