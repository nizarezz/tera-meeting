import type { NextConfig } from "next";
import bundleAnalyzer from "@next/bundle-analyzer";

const withBundleAnalyzer = bundleAnalyzer({ enabled: process.env.ANALYZE === "true" });

const nextConfig: NextConfig = {
  experimental: {
    optimizePackageImports: ["@tanstack/react-query", "lucide-react"],
  },
  allowedDevOrigins: ["http://192.168.1.150"],
};

export default withBundleAnalyzer(nextConfig);
