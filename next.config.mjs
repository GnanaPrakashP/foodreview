import { withSentryConfig } from "@sentry/nextjs";

// Deliberately .mjs rather than .ts. `next start` loads this file at runtime,
// and loading a TypeScript config requires the `typescript` package to be
// present. The media worker image runs `npm prune --omit=dev`, which removes it
// — so `next start` tried to auto-install typescript inside the container,
// failed on a root-owned npm cache, and exited 1 before the worker could reach
// its health check. The file contained no TypeScript beyond a type import and
// one annotation, so dropping the compiler dependency is cheaper than shipping
// a compiler to production.
const nextConfig = {
  devIndicators: false,
  async headers() {
    return [{
      source: "/api/:path*",
      headers: [
        { key: "Cache-Control", value: "private, no-store" },
        { key: "Content-Security-Policy", value: "default-src 'none'; frame-ancestors 'none'; base-uri 'none'" },
        { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        { key: "Referrer-Policy", value: "no-referrer" },
        { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "X-Frame-Options", value: "DENY" },
      ],
    }];
  },
  turbopack: {
    root: process.cwd(),
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "*.supabase.co",
        pathname: "/storage/v1/object/public/**",
      },
      {
        protocol: "https",
        hostname: "*.supabase.co",
        pathname: "/storage/v1/render/image/public/**",
      },
    ],
  },
};

export default withSentryConfig(nextConfig, {
  authToken: process.env.SENTRY_AUTH_TOKEN,
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  silent: !process.env.CI,
  telemetry: false,
  sourcemaps: {
    deleteSourcemapsAfterUpload: true
  }
});
