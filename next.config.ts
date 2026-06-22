import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Server components need access to Node.js fs for file operations
  serverExternalPackages: ['@google/genai'],
  outputFileTracingExcludes: {
    '/*': [
      './D/**/*',
      './.git/**/*',
      './.gitignore',
      './app/**/*',
      './components/**/*',
      './lib/**/*',
      './scripts/**/*',
      './*.md',
      './*.bat',
      './*.mjs',
      './tsconfig.json',
      './eslint.config.mjs',
      './next.config.ts',
    ],
  },
};

export default nextConfig;
