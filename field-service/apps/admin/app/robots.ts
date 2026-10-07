import type { MetadataRoute } from 'next';
export default function robots(): MetadataRoute.Robots {
 return { rules: { userAgent: '*', allow: '/', disallow: ['/shop', '/console', '/join/'] }, sitemap: 'https://koochang.com/sitemap.xml' };
}
