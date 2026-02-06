/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    optimizeCss: true,
  },
  turbopack: {},
  webpack: (config, { buildId, dev, isServer, defaultLoaders, webpack }) => {
    // Add support for loading workers
    config.module.rules.push({
      test: /\.worker\.(js|ts)$/,
      use: { loader: 'worker-loader' },
    });

    // Add WASM support
    config.experiments = {
      ...config.experiments,
      asyncWebAssembly: true,
      layers: true,
    };

    return config;
  },
  // Configure for TensorFlow.js
  env: {
    TENSORFLOW_BACKEND: 'webgl', // or 'wasm' or 'cpu'
  },
}

module.exports = nextConfig;
