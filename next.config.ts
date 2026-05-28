import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  reactStrictMode: false,
  // Disable Turbopack for production builds (fixes workspace root detection issue)
  experimental: {
    turbo: undefined,
  },
};

export default nextConfig;
