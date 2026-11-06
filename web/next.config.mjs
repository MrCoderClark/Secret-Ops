/** @type {import('next').NextConfig} */
const nextConfig = {
  // Produce a self-contained server bundle at .next/standalone. The Dockerfile
  // copies it into the runtime image so the deploy has no `pnpm install` step.
  output: "standalone",

  experimental: {
    // argon2 is a native addon loaded via a dynamic require() inside a
    // try/catch (web/lib/crypto.ts). Marking it external keeps the Next.js
    // bundler from pulling the .node file into the server bundle — the
    // Dockerfile copies the module into the runtime image so the require
    // resolves at boot. In Next.js 15 this key is promoted to top-level
    // `serverExternalPackages`; keep it under `experimental` while on 14.x.
    serverComponentsExternalPackages: ["argon2"],
  },

  // Belt-and-braces security headers. middleware.ts adds request-ids and the
  // cross-origin guard at runtime; these are the ones that apply to every
  // response, so setting them at the framework edge is the right place.
  async headers() {
    const prod = process.env.NODE_ENV === "production";
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
          },
          ...(prod
            ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" }]
            : []),
        ],
      },
      {
        // Reveal and pull-bundle routes must never be cached anywhere.
        // Route handlers set this header themselves too; defence in depth.
        source: "/api/secrets/:id/reveal",
        headers: [
          { key: "Cache-Control", value: "no-store, max-age=0" },
          { key: "Pragma", value: "no-cache" },
        ],
      },
      {
        source: "/api/sync/:id/bundle",
        headers: [
          { key: "Cache-Control", value: "no-store, max-age=0" },
          { key: "Pragma", value: "no-cache" },
        ],
      },
    ];
  },
};

export default nextConfig;
