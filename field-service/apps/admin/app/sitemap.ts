import type { MetadataRoute } from 'next';
import { legalReady } from './legal-content';
// Legal pages stay out until they are indexable (legalReady), so Search Console never sees a noindex URL here.
export default function sitemap(): MetadataRoute.Sitemap {
 const legal = legalReady ? [{ url: 'https://koochang.com/privacy' }, { url: 'https://koochang.com/terms' }] : [];
 return [{ url: 'https://koochang.com/', changeFrequency: 'weekly', priority: 1 }, ...legal];
}
