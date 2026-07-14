import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["oracledb", "cfb", "playwright"],
};

export default nextConfig;
