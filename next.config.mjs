/** @type {import('next').NextConfig} */
// When served behind a stripping path-proxy (e.g. Tailscale Funnel mounts a
// sub-path like /groc and strips it before forwarding), the app stays at root
// internally but must emit asset URLs WITH the prefix so the browser re-enters
// through the same mount. Empty prefix = served at root (local/dev).
const prefix = process.env.NEXT_PUBLIC_PATH_PREFIX || "";

const nextConfig = {
  reactStrictMode: true,
  ...(prefix ? { assetPrefix: prefix } : {}),
};

export default nextConfig;
