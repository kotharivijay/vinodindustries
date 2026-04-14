const { execSync } = require('child_process')

let buildId = 'dev'
try {
  buildId = execSync('git rev-parse --short HEAD').toString().trim()
} catch {}

/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: '20mb',
    },
    serverComponentsExternalPackages: ['googleapis'],
  },
  env: {
    NEXT_PUBLIC_BUILD_ID: buildId,
  },
}

module.exports = nextConfig
