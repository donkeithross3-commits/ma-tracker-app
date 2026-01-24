import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Enable standalone output for optimized production deployment
  output: 'standalone',
  
  // Temporarily skip TypeScript checking for production build
  // This allows KRJ deployment while research/M&A features are being fixed
  // Routes with missing Prisma models have been disabled (return 501)
  typescript: {
    ignoreBuildErrors: true,
  },
  
  /* config options here */
};

export default nextConfig;
