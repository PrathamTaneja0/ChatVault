#!/usr/bin/env node
/**
 * Generate the extension icon set from a single SVG source.
 *
 * Design: a chat bubble with an export (down) arrow on a slate rounded
 * square — simple, sharp, and legible from 16px to 128px.
 *
 * Usage: npm run icons
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, '..', 'public', 'icon');
mkdirSync(outDir, { recursive: true });

const ICON_SVG = `
<svg width="128" height="128" viewBox="0 0 128 128" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#28344e"/>
      <stop offset="1" stop-color="#0e1424"/>
    </linearGradient>
    <linearGradient id="arrow" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#818cf8"/>
      <stop offset="1" stop-color="#5b5ff0"/>
    </linearGradient>
  </defs>

  <!-- Background: rounded square, subtle vertical gradient + hairline edge -->
  <rect x="2" y="2" width="124" height="124" rx="30" fill="url(#bg)"/>
  <rect x="3.5" y="3.5" width="121" height="121" rx="28.5" fill="none"
        stroke="rgba(255,255,255,0.09)" stroke-width="3"/>

  <!-- Chat bubble (filled, tail bottom-left) -->
  <path d="M46 28h36c12.15 0 22 9.85 22 22v14c0 12.15-9.85 22-22 22H62.5
           L45 100.5c-1.3 1.15-3.35.23-3.35-1.51V85.4C32.7 82.4 24 73.9 24 64V50
           c0-12.15 9.85-22 22-22z"
        fill="#f4f6fb"/>

  <!-- Export arrow -->
  <path d="M64 40v24" stroke="url(#arrow)" stroke-width="9" stroke-linecap="round"/>
  <path d="M51 56l13 13 13-13" fill="none" stroke="url(#arrow)"
        stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>
</svg>
`;

const SIZES = [16, 48, 128];

for (const size of SIZES) {
  const png = await sharp(Buffer.from(ICON_SVG), { density: (72 * size) / 128 })
    .resize(size, size)
    .png()
    .toBuffer();
  writeFileSync(join(outDir, `${size}.png`), png);
  console.log(`Created icon/${size}.png (${png.length} bytes)`);
}
