import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
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
    // The docs site reads its Markdown from disk at request time, plus the
    // three repository files it renders in place of copying them.
    "/docs/[[...slug]]": [
      "./docs/site/*.md",
      "./docs/API.md",
      "./docs/GONKA-INTEGRATION.md",
      "./AGENTS.md",
    ],
    "/sitemap.xml": ["./docs/site/*.md"],
  },
  // CSP is omitted because wallet extensions and the Enoki sign-in popup
  // inject scripts.
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          {
            key: "Strict-Transport-Security",
            value: "max-age=31536000",
          },
          {
            key: "X-Content-Type-Options",
            value: "nosniff",
          },
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
          {
            key: "X-Frame-Options",
            value: "SAMEORIGIN",
          },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
