/** @type {import("next").NextConfig} */
const nextConfig = {
  async rewrites() {
    return [
      {
        // Proxy Odoo product images through our own domain
        // so the browser treats them as same-origin (no CORS/referrer issues)
        source: '/product-image',
        destination: 'https://in-your-shoe.odoo.com/web/image',
      },
    ]
  },
};
export default nextConfig;
