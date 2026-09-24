const dateFmt = new Intl.DateTimeFormat('th-TH', { day: 'numeric', month: 'short', year: '2-digit' });
const dateTimeFmt = new Intl.DateTimeFormat('th-TH', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});
const timeFmt = new Intl.DateTimeFormat('th-TH', { hour: '2-digit', minute: '2-digit' });

export const fmtDate = (v: string | null | undefined) => (v ? dateFmt.format(new Date(v)) : '—');
export const fmtDateTime = (v: string | null | undefined) => (v ? dateTimeFmt.format(new Date(v)) : '—');
export const fmtTime = (v: string | null | undefined) => (v ? timeFmt.format(new Date(v)) : '');

export function mapUrl(site: { lat: number | null; lng: number | null; addressText: string | null } | null): string | null {
  if (!site) return null;
  if (site.lat !== null && site.lng !== null) return `https://www.google.com/maps/search/?api=1&query=${site.lat},${site.lng}`;
  if (site.addressText) return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(site.addressText)}`;
  return null;
}

export const telUrl = (phone: string | null) => (phone ? `tel:${phone.replace(/\D/g, '')}` : null);
