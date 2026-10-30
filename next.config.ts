import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  // Every response, including pages, redirects and errors, is nosniff
  // (docs/privacy-audit.md). Media routes also set it themselves.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [{ key: "X-Content-Type-Options", value: "nosniff" }],
      },
    ]
  },
}

export default nextConfig
