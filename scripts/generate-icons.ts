// Generates the 5 PWA / favicon assets from `public/beakn-logo-master.png`.
// Run once when the master logo changes:
//
//   pnpm icons:generate
//
// Outputs (all in public/):
//   icon-192x192.png        — any-purpose, downscaled from 512.
//   icon-512x512.png        — any-purpose, passthrough re-encode.
//   icon-512x512-maskable.png — maskable per W3C spec: logo scaled to ~80% (410px)
//                               and centered on a 512x512 canvas filled with the
//                               manifest theme_color #0F766E. Android adaptive icon
//                               crops the outer 10% — the safe-zone padding makes
//                               the logo fully visible regardless of mask shape.
//   apple-touch-icon.png    — 180x180 iOS Add-to-Home-Screen.
//   favicon.ico             — multi-size ICO (16/32/48) with PNG-encoded entries.

import { promises as fs } from 'node:fs';
import path from 'node:path';

import sharp from 'sharp';

const PUBLIC_DIR = path.join(process.cwd(), 'public');
const MASTER = path.join(PUBLIC_DIR, 'beakn-logo-master.png');

// Deep Teal — matches manifest theme_color; locked in HVA-12.
const PADDING_FILL = { r: 0x0f, g: 0x76, b: 0x6e, alpha: 1 };

async function generateAnyPurpose(size: number, outName: string) {
  const out = path.join(PUBLIC_DIR, outName);
  await sharp(MASTER)
    .resize(size, size, { fit: 'cover', kernel: 'lanczos3' })
    .png({ compressionLevel: 9 })
    .toFile(out);
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
      background: PADDING_FILL,
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
    generateAnyPurpose(180, 'apple-touch-icon.png'),
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
