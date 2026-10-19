import type { MetadataRoute } from 'next';

// The site is meant to be found; its API is not a page.
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: '*', allow: '/', disallow: '/api/' } };
}
