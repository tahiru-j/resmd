/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ['@react-pdf/renderer', 'pdfjs-dist'],
  transpilePackages: ['markitdown-ts'],
  outputFileTracingIncludes: {
    '/api/export/pdf': ['./public/fonts/**/*'],
  },
  experimental: {
    optimizePackageImports: ['@phosphor-icons/react'],
  },
};

module.exports = nextConfig;
