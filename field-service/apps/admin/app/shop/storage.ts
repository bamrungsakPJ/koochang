/** Shop sessions are isolated from platform accounts and expire when the tab closes. */
export const keys = { access: 'shop.access', refresh: 'shop.refresh', language: 'shop.language', organization: 'shop.organization', route: 'shop.route' };
export const storage = {
  async get(key: string): Promise<string | null> {
    try { return (key === keys.language ? localStorage : sessionStorage).getItem(key); } catch { return null; }
  },
  async set(key: string, value: string | null): Promise<void> {
    const target = key === keys.language ? localStorage : sessionStorage;
    if (value === null) target.removeItem(key); else target.setItem(key, value);
  },
};
