// Builds every brand asset from the selected KooChang design (branding/koochang/*.png, chosen by
// the owner 2026-10-05): mobile icon, Android adaptive + themed icon, native splash emblem, the
// in-app start screen, web favicons and the default brand mark.
// The masters are generated rasters whose navy varies slightly, so the symbol and the splash
// lockup are lifted off their background with a soft colour key and recomposited on one exact
// navy. Run: node scripts/make-app-icons.mjs
import { mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const sharp = createRequire(new URL('../apps/api/package.json', import.meta.url))('sharp');
const path = rel => fileURLToPath(new URL(`../${rel}`, import.meta.url));
const NAVY = { r: 0x12, g: 0x24, b: 0x3a };   // production primary #12243A
const SRC_BG = { r: 0x0f, g: 0x25, b: 0x40 };   // average background of the masters

/** Background → transparent; anti-aliased edges keep their colour (un-mixed from the navy). */
async function keyOut(file, crop) {
  let image = sharp(path(file)).removeAlpha();
  if (crop) image = image.extract(crop);
  const { data, info } = await image.raw().toBuffer({ resolveWithObject: true });
  const out = Buffer.alloc(info.width * info.height * 4);
  for (let i = 0, o = 0; i < data.length; i += 3, o += 4) {
    const c = [data[i], data[i + 1], data[i + 2]], bg = [SRC_BG.r, SRC_BG.g, SRC_BG.b];
    const d = Math.max(...c.map((v, k) => Math.abs(v - bg[k])));
    const a = Math.min(1, Math.max(0, (d - 22) / 70));
    for (let k = 0; k < 3; k++) out[o + k] = a ? Math.min(255, Math.max(0, Math.round((c[k] - (1 - a) * bg[k]) / a))) : 0;
    out[o + 3] = Math.round(a * 255);
  }
  return sharp(out, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer();
}
const trimmed = async png => sharp(await sharp(png).trim({ threshold: 1 }).png().toBuffer());
/** Places `png` centred on a square canvas, its longer side `fraction` of `size`. */
async function onSquare(png, size, fraction, background = { r: 0, g: 0, b: 0, alpha: 0 }) {
  const inner = Math.round(size * fraction);
  const fitted = await sharp(png).resize(inner, inner, { fit: 'inside' }).png().toBuffer();
  return sharp({ create: { width: size, height: size, channels: 4, background } }).composite([{ input: fitted, gravity: 'center' }]).png();
}
const write = async (image, rel) => { await image.toFile(path(rel)); console.log('written', rel); };

const symbol = await (await trimmed(await keyOut('branding/koochang/app-icon.png'))).png().toBuffer();
// Emblem + "KooChang" + "คู่ช่าง" from the splash master (portrait 887×1774).
const lockup = await (await trimmed(await keyOut('branding/koochang/splash-screen.png', { left: 100, top: 520, width: 687, height: 720 }))).png().toBuffer();
const navyOpaque = { ...NAVY, alpha: 1 };

await mkdir(path('apps/mobile/assets'), { recursive: true });
await mkdir(path('apps/admin/public'), { recursive: true });
// Store / legacy icon: full-bleed navy, symbol at the master's proportion (iOS rejects transparency).
await write((await onSquare(symbol, 1024, 0.64, navyOpaque)).flatten({ background: NAVY }), 'apps/mobile/assets/icon.png');
// Android adaptive icon: navy background colour + symbol inside the 66% safe circle.
await write(await onSquare(symbol, 1024, 0.5), 'apps/mobile/assets/adaptive-foreground.png');
const mono = await sharp(await (await onSquare(symbol, 1024, 0.5)).toBuffer()).ensureAlpha().extractChannel(3).toBuffer();
await write(sharp({ create: { width: 1024, height: 1024, channels: 3, background: '#000' } }).joinChannel(mono).png(), 'apps/mobile/assets/adaptive-monochrome.png');
// Native splash (Android 12+ shows only a centred emblem) and the in-app start screen lockup.
await write(await onSquare(symbol, 1024, 0.62), 'apps/mobile/assets/splash-icon.png');
await write(sharp(lockup).resize({ width: 900, withoutEnlargement: true }).png(), 'apps/mobile/assets/splash-lockup.png');
await write((await onSquare(symbol, 48, 0.8, navyOpaque)).flatten({ background: NAVY }), 'apps/mobile/assets/favicon.png');
// Web: tab icons and the default brand mark (rounded by CSS); the console can still upload its own.
for (const size of [32, 192, 512]) await write((await onSquare(symbol, size, 0.72, navyOpaque)).flatten({ background: NAVY }), `apps/admin/public/icon-${size}.png`);
await write((await onSquare(symbol, 180, 0.66, navyOpaque)).flatten({ background: NAVY }), 'apps/admin/public/apple-touch-icon.png');
