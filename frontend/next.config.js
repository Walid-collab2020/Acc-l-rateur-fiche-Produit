/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    proxyTimeout: 3600000, // 60 minutes — extraction LLM peut prendre 15-25 min sur 3 docs
  },
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: "http://localhost:8000/api/:path*",
      },
    ];
  },
};

module.exports = nextConfig;
