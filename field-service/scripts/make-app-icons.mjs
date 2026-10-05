// Generates the mobile app icon, Android adaptive/monochrome icon, splash image and web favicon
// from the KooChang mark (blue tile, white wrench; same drawing as apps/admin/public/icon.svg).
// Run: node scripts/make-app-icons.mjs   (uses sharp from the API workspace)
import { mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';

const sharp = createRequire(new URL('../apps/api/package.json', import.meta.url))('sharp');
const out = new URL('../apps/mobile/assets/', import.meta.url);
await mkdir(out, { recursive: true });

const gradient = `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2563eb"/><stop offset=".55" stop-color="#1d4ed8"/><stop offset="1" stop-color="#1e3a8a"/></linearGradient></defs>`;
// Wrench drawn in a 64-unit box; `scale`/`offset` place it on the 1024 canvas.
const wrench = (scale, offset, color = '#fff') => `<g transform="translate(${offset} ${offset}) scale(${scale})"><path d="M38.6 18.4a9 9 0 0 0-11.5 11.1L17.4 39.2a3.5 3.5 0 1 0 5 5l9.7-9.7a9 9 0 0 0 11.1-11.5l-5.4 5.4-4.9-1.4-1.4-4.9z" fill="none" stroke="${color}" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round"/></g>`;
const svg = body => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">${gradient}${body}</svg>`);

const files = {
  // Store/legacy icon: full-bleed square (iOS rejects transparency; launchers round the corners).
  'icon.png': svg(`<rect width="1024" height="1024" fill="url(#g)"/>${wrench(16, 0)}`),
  // Adaptive icon: background layer + foreground kept inside the 66% safe zone.
  'adaptive-background.png': svg(`<rect width="1024" height="1024" fill="url(#g)"/>`),
  'adaptive-foreground.png': svg(wrench(10, 192)),
  // Android 13+ themed icons recolour this single-colour layer.
  'adaptive-monochrome.png': svg(wrench(10, 192, '#000')),
  // Splash: the rounded tile on the splash background colour.
  'splash-icon.png': svg(`<rect x="64" y="64" width="896" height="896" rx="224" fill="url(#g)"/>${wrench(14, 64)}`),
};
for (const [name, data] of Object.entries(files)) await sharp(data).png().toFile(new URL(name, out).pathname.replace(/^\/([A-Z]:)/, '$1'));
await sharp(files['splash-icon.png']).resize(48, 48).png().toFile(new URL('favicon.png', out).pathname.replace(/^\/([A-Z]:)/, '$1'));
console.log('written:', [...Object.keys(files), 'favicon.png'].join(', '));
