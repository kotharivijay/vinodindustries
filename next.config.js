/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: '20mb',
    },
    serverComponentsExternalPackages: ['googleapis'],
  },
}

module.exports = nextConfig
