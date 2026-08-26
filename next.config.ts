import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pglite ships wasm assets; keep it external to the server bundle
  serverExternalPackages: ["@electric-sql/pglite"],
};

export default nextConfig;
