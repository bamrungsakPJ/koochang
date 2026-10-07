import type { MetadataRoute } from 'next';
export default function sitemap(): MetadataRoute.Sitemap {
 return [{ url: 'https://koochang.com/' }, { url: 'https://koochang.com/privacy' }, { url: 'https://koochang.com/terms' }];
}
