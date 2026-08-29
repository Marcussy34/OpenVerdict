import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // These ship wasm assets; keep them external to the server bundle. Being
  // listed here is also what lets the tracer follow them into the serverless
  // function, so the runtime `require` actually resolves.
  serverExternalPackages: ["@electric-sql/pglite", "@mysten/walrus"],
  // The release manifest is read at runtime from a path in
  // OPENVERDICT_RELEASE_MANIFEST, so the file tracer cannot see it statically
  // and the JSON never reached the serverless bundle: every API route 503'd
  // with "release manifest is missing: config/release.testnet.json". Every
  // route reaches the engine through getServerEngine, so trace it globally.
  outputFileTracingIncludes: {
    "/*": ["./config/*.json"],
  },
};

export default nextConfig;
