import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  agentRules: false,
  devIndicators: false,
  // the SDK is consumed as TypeScript source from the workspace
  transpilePackages: ["@blindspot/sdk"],
};

export default nextConfig;
