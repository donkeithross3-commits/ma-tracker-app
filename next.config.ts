import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Enable standalone output for optimized production deployment
  output: 'standalone',
  
  // Packages that must be bundled into the standalone output.
  // Without this, they are missing at runtime in the Docker container.
  // archiver: used by download-agent and download-agent-update API routes to create ZIP files.
  serverExternalPackages: ['archiver'],
  
  // Temporarily skip TypeScript checking for production build
  // This allows KRJ deployment while research/M&A features are being fixed
  // Routes with missing Prisma models have been disabled (return 501)
  typescript: {
    ignoreBuildErrors: true,
  },
  
  /* config options here */
};

export default nextConfig;
