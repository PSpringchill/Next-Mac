/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack: (config, { isServer }) => {
    if (isServer) {
      config.externals.push('plotly.js-dist-min');
      config.resolve.fallback = false;
    }
    return config;
  },
  experimental: {
    optimizeCss: true
  }
};

export default nextConfig;
