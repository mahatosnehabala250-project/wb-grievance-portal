import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Vercel handles deployment automatically without standalone
  /* config options here */
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
};

export default nextConfig;
