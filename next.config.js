/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    instrumentationHook: true,
    serverComponentsExternalPackages: ['pg', 'pg-pool', 'pg-protocol', 'pg-types'],
  },

  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        dns: false,
        net: false,
        tls: false,
        fs: false,
        crypto: false,
        stream: false,
        path: false,
        os: false,
      };
    }
    return config;
  },
};

module.exports = nextConfig;
