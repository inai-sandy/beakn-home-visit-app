// Generates the 5 PWA / favicon assets from `public/beakn-logo-master.png`.
// Run once when the master logo changes:
//
//   pnpm icons:generate
//
// Outputs (all in public/):
//   icon-192x192.png        — any-purpose, downscaled from 512.
//   icon-512x512.png        — any-purpose, passthrough re-encode.
//   icon-512x512-maskable.png — maskable per W3C spec: logo scaled to ~80% (410px)
//                               and centered on a 512x512 white canvas. Android
//                               adaptive icon crops the outer 10% — the safe-zone
//                               padding makes the logo fully visible regardless of
//                               mask shape. White (not the teal theme_color) so the
//                               home-screen icon matches iOS's white background.
//   apple-touch-icon.png    — 180x180 iOS Add-to-Home-Screen, flattened onto white
//                               (iOS composites PNG alpha onto black otherwise).
//   favicon.ico             — multi-size ICO (16/32/48) with PNG-encoded entries.

import { promises as fs } from 'node:fs';
import path from 'node:path';

import sharp from 'sharp';

const PUBLIC_DIR = path.join(process.cwd(), 'public');
const MASTER = path.join(PUBLIC_DIR, 'beakn-logo-master.png');

// Solid white — home-screen icon background. iOS ignores PNG alpha on
// Add-to-Home-Screen icons and composites transparency onto BLACK, so any
// icon that can land on a home screen must carry an opaque background. White
// keeps the teal "b" mark reading cleanly on both iOS and Android.
const WHITE = { r: 0xff, g: 0xff, b: 0xff, alpha: 1 };

async function generateAnyPurpose(
  size: number,
  outName: string,
  // When set, the transparent master is flattened onto this opaque colour.
  // Used for apple-touch-icon (iOS home screen) so the logo isn't shown on
  // black. Omitted for the manifest "any" icons, which stay transparent so
  // they float cleanly on the login page and the white PWA splash.
  background?: { r: number; g: number; b: number; alpha: number },
) {
  const out = path.join(PUBLIC_DIR, outName);
  let pipeline = sharp(MASTER).resize(size, size, { fit: 'cover', kernel: 'lanczos3' });
  if (background) {
    pipeline = pipeline.flatten({ background });
  }
  await pipeline.png({ compressionLevel: 9 }).toFile(out);
  return out;
}

async function generateMaskable512(): Promise<string> {
  const out = path.join(PUBLIC_DIR, 'icon-512x512-maskable.png');
  const innerSize = Math.round(512 * 0.8); // 410 — fits inside the 80% safe zone
  const offset = Math.round((512 - innerSize) / 2);

  const inner = await sharp(MASTER)
    .resize(innerSize, innerSize, { fit: 'cover', kernel: 'lanczos3' })
    .png()
    .toBuffer();

  await sharp({
    create: {
      width: 512,
      height: 512,
      channels: 4,
      background: WHITE,
    },
  })
    .composite([{ input: inner, left: offset, top: offset }])
    .png({ compressionLevel: 9 })
    .toFile(out);

  return out;
}

// Minimal ICO encoder. ICONDIR + ICONDIRENTRY[] + PNG payloads concatenated.
// Modern browsers (>= IE11 era) accept PNG-encoded entries inside ICO.
async function generateFaviconIco(): Promise<string> {
  const sizes = [16, 32, 48];
  const pngs = await Promise.all(
    sizes.map((s) =>
      sharp(MASTER)
        .resize(s, s, { fit: 'cover', kernel: 'lanczos3' })
        .png({ compressionLevel: 9 })
        .toBuffer(),
    ),
  );

  const HEADER_SIZE = 6;
  const ENTRY_SIZE = 16;
  const dirSize = HEADER_SIZE + ENTRY_SIZE * sizes.length;

  const header = Buffer.alloc(HEADER_SIZE);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type 1 = ICO
  header.writeUInt16LE(sizes.length, 4);

  const entries: Buffer[] = [];
  let offset = dirSize;
  for (let i = 0; i < sizes.length; i += 1) {
    const e = Buffer.alloc(ENTRY_SIZE);
    const s = sizes[i];
    e.writeUInt8(s === 256 ? 0 : s, 0); // width (0 means 256)
    e.writeUInt8(s === 256 ? 0 : s, 1); // height
    e.writeUInt8(0, 2); // palette
    e.writeUInt8(0, 3); // reserved
    e.writeUInt16LE(1, 4); // planes
    e.writeUInt16LE(32, 6); // bpp
    e.writeUInt32LE(pngs[i].length, 8); // size of PNG data
    e.writeUInt32LE(offset, 12); // offset to PNG data
    entries.push(e);
    offset += pngs[i].length;
  }

  const ico = Buffer.concat([header, ...entries, ...pngs]);
  const out = path.join(PUBLIC_DIR, 'favicon.ico');
  await fs.writeFile(out, ico);
  return out;
}

async function main() {
  // Confirm master exists before kicking off the pipeline.
  await fs.access(MASTER);

  const outputs = await Promise.all([
    generateAnyPurpose(192, 'icon-192x192.png'),
    generateAnyPurpose(512, 'icon-512x512.png'),
    generateAnyPurpose(180, 'apple-touch-icon.png', WHITE),
    generateMaskable512(),
    generateFaviconIco(),
  ]);

  console.log('[icons:generate] outputs:');
  for (const p of outputs) {
    const stat = await fs.stat(p);
    console.log(`  ${path.relative(process.cwd(), p)}  (${stat.size} bytes)`);
  }
}

main().catch((err) => {
  console.error('[icons:generate] failed:', err);
  process.exit(1);
});
