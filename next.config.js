/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  basePath: '/simplenotebook',
  assetPrefix: '/simplenotebook/',
  experimental: {
    externalDir: true,
  },
  webpack: (config, { isServer }) => {
    // Exclude CDK directory from compilation
    config.watchOptions = {
      ...config.watchOptions,
      ignored: ['**/cdk/**', '**/node_modules/**'],
    };
    return config;
  },
}

module.exports = nextConfig
