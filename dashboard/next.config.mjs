/** @type {import('next').NextConfig} */
// FIX-14: baseline security headers. CSP is intentionally permissive on
// inline styles/scripts because Next's app router emits both for hydration
// and `<style jsx>`. Tighten with nonces in a later pass.
const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Content-Security-Policy",
    value:
      "default-src 'self'; " +
      "img-src 'self' data: https:; " +
      "style-src 'self' 'unsafe-inline'; " +
      "script-src 'self' 'unsafe-inline'; " +
      "connect-src 'self' https://*.supabase.co; " +
      "font-src 'self' data:; " +
      "frame-ancestors 'none'",
  },
];

const nextConfig = {
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
