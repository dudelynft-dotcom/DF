/** @type {import('next').NextConfig} */

// Content-Security-Policy allowlist.
//
// Scripts are kept permissive ('unsafe-inline' + 'unsafe-eval') because Next.js
// and wagmi rely on inline bootstrap scripts and WebAssembly-style eval for
// viem. Tightening further requires nonces + per-request header generation,
// which breaks static export and costs runtime. The real risk we mitigate here
// is a compromised NPM dependency that tries to exfiltrate user data to an
// attacker-controlled host: `connect-src` + `img-src` + `frame-src` restrict
// where the page may talk to.
const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob: https:",
  "connect-src 'self' https: wss:",
  "frame-src 'self' https://verify.walletconnect.com https://verify.walletconnect.org",
  "worker-src 'self' blob:",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy",   value: csp },
  { key: "X-Content-Type-Options",    value: "nosniff" },
  { key: "X-Frame-Options",           value: "DENY" },
  { key: "Referrer-Policy",           value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy",        value: "camera=(), microphone=(), geolocation=(), interest-cohort=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
];

const nextConfig = {
  reactStrictMode: true,
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
