/** @type {import('next').NextConfig} */
// FIX-14: baseline security headers. CSP is intentionally permissive on
// inline styles/scripts because Next's app router emits both for hydration
// and `<style jsx>`. Dev needs 'unsafe-eval' too — Next's React Refresh
// runtime uses eval() for HMR.
const isDev = process.env.NODE_ENV !== "production";

const scriptSrc = isDev
  ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
  : "script-src 'self' 'unsafe-inline'";

const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Content-Security-Policy",
    value:
      "default-src 'self'; " +
      "img-src 'self' data: https:; " +
      "style-src 'self' 'unsafe-inline'; " +
      scriptSrc + "; " +
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
