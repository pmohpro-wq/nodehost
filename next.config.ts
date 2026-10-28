import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  reactStrictMode: false,
  // This repo is often checked out INSIDE another workspace (sandbox with a
  // parent lockfile). Pin the Turbopack workspace root to the repo itself so
  // module resolution (prisma engines, react) never walks up to the parent.
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;
