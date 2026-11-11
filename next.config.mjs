/** @type {import("next").NextConfig} */
const nextConfig = {
  // "/" serves the redesigned dashboard (self-contained page in /public). The previous live Metabase view stays at /classic.
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
