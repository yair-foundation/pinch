import type { NextConfig } from 'next';

const config: NextConfig = {
  reactStrictMode: true,
  // The routes set this themselves; this keeps it on any error page under /api too.
  headers: async () => [
    {
      source: '/api/:path*',
      headers: [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }],
    },
  ],
};

export default config;
