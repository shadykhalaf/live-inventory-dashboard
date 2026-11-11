/** @type {import("next").NextConfig} */
const nextConfig = {
  // "/" is the redesigned dashboard (self-contained page in /public, fed live from Metabase via /api/live-data).
  // The previous dashboard stays available at /v1.
  async rewrites() {
    return {
      beforeFiles: [
        { source: '/', destination: '/revenue-v2.html' },
        { source: '/v2', destination: '/revenue-v2.html' },
      ],
    };
  },
};
export default nextConfig;
