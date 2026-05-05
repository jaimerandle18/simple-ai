/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@shared/types'],
  output: 'standalone',
};

module.exports = nextConfig;
