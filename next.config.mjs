/** @type {import("next").NextConfig} */
const nextConfig = {
  // Redesigned (brutalist) dashboard, shipped as a self-contained page. The live Metabase dashboard at "/" is untouched.
  async rewrites() {
    return [{ source: '/v2', destination: '/revenue-v2.html' }];
  },
};
export default nextConfig;
