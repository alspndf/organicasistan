import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ['child_process', 'better-sqlite3'],
};

export default nextConfig;
