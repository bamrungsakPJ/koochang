'use client';
import { useEffect, useState, type ReactNode } from 'react';

/** Brand logo and favicon set by a super admin in the console (GET /v1/branding is public).
 * Until it loads, or when nothing is set, the built-in icon and app/icon.svg are shown. */
export interface Branding { version: number; logo: boolean; favicon: boolean; favicon_custom: boolean; updated_at: string | null }

const api = `${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'}/v1`;
export const brandImageUrl = (kind: 'logo' | 'favicon', version: number) => `${api}/branding/${kind}.png?v=${version}`;

let current: Branding | null = null;
let pending: Promise<void> | null = null;
const listeners = new Set<(b: Branding | null) => void>();

function publish(next: Branding | null) { current = next; listeners.forEach(l => l(next)); }

/** Loads the brand again (after a change in the console) and updates every mark and the tab icon. */
export function refreshBranding(next?: Branding): Promise<void> {
  if (next) { publish(next); return Promise.resolve(); }
  pending = fetch(`${api}/branding`, { cache: 'no-store' }).then(r => r.ok ? r.json() as Promise<Branding> : null)
    .then(publish, () => {}).finally(() => { pending = null; });
  return pending;
}

export function useBranding(): Branding | null {
  const [brand, setBrand] = useState(current);
  useEffect(() => {
    listeners.add(setBrand);
    if (!current && !pending) void refreshBranding();
    return () => { listeners.delete(setBrand); };
  }, []);
  return brand;
}

/** The square mark next to the product name: the uploaded logo, or the given icon. */
export function BrandMark({ icon, large }: { icon: ReactNode; large?: boolean }) {
  const brand = useBranding();
  const logo = brand?.logo ? brandImageUrl('logo', brand.version) : null;
  return <span className={`brand-mark${large ? ' lg' : ''}${logo ? ' has-logo' : ''}`} aria-hidden>
    {logo ? <img src={logo} alt="" /> : icon}</span>;
}

/** Points the browser tab icon at the uploaded favicon (rendered once in the root layout). */
export function BrandFavicon() {
  const brand = useBranding();
  useEffect(() => {
    const href = brand?.favicon ? brandImageUrl('favicon', brand.version) : '/icon.svg';
    let link = document.querySelector<HTMLLinkElement>('link[data-brand-icon]');
    if (!link) {
      document.querySelectorAll('link[rel="icon"]').forEach(l => l.remove());
      link = document.createElement('link'); link.rel = 'icon'; link.dataset.brandIcon = ''; document.head.appendChild(link);
    }
    link.type = brand?.favicon ? 'image/png' : 'image/svg+xml';
    link.href = href;
  }, [brand]);
  return null;
}
