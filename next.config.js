/** @type {import('next').NextConfig} */
const nextConfig = {
  // Исключает pg (и его зависимости) из webpack-бандла.
  // Работает в Next.js 14.1+ (заменяет устаревший experimental.serverComponentsExternalPackages).
  serverExternalPackages: ['pg', 'pg-pool', 'pg-protocol', 'pg-types'],

  webpack: (config, { isServer }) => {
    if (!isServer) {
      // На клиенте полностью заглушаем Node.js-модули, которые использует pg.
      // Это страховочный слой на случай если какой-то транзитивный импорт pg
      // всё же попадёт в клиентский граф.
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
        child_process: false,
      };
    }
    return config;
  },
};

module.exports = nextConfig;
