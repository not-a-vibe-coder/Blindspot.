import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // the SDK is consumed as TypeScript source from the workspace
  transpilePackages: ["@blindspot/sdk"],
};

export default nextConfig;
