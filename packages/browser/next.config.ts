import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  images: { unoptimized: true },
  reactStrictMode: true,
  allowedDevOrigins: ["127.0.0.1"],
  transpilePackages: ["@ux4/core"],
};

export default nextConfig;
