import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Server components need access to Node.js fs for file operations
  serverExternalPackages: ['@google/genai'],
};

export default nextConfig;
