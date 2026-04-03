import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ['child_process', 'better-sqlite3'],
  experimental: {
    turbo: {
      rules: {
        '*.node': { loaders: [], as: '*.node' },
      },
    },
  },
};

export default nextConfig;
