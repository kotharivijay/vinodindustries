/** @type {import('next').NextConfig} */
const nextConfig = {
  // Server-side rendering enabled for NextAuth and API routes
  experimental: {
    serverComponentsExternalPackages: ['@vercel/blob'],
  },
}

module.exports = nextConfig