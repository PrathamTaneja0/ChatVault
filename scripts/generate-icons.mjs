#!/usr/bin/env node
/**
 * Generate the extension icon set from a single SVG source.
 *
 * Design: the classic ChatVault glossy dark orb with a white document sheet
 * (folded corner, text lines) and an indigo export-arrow badge — legible
 * from 16px to 128px.
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
    <radialGradient id="orb" cx="0.34" cy="0.28" r="1">
      <stop offset="0" stop-color="#4d5566"/>
      <stop offset="0.5" stop-color="#252b38"/>
      <stop offset="1" stop-color="#0c0f16"/>
    </radialGradient>
    <linearGradient id="sheen" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="rgba(255,255,255,0.38)"/>
      <stop offset="1" stop-color="rgba(255,255,255,0)"/>
    </linearGradient>
    <linearGradient id="badge" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#818cf8"/>
      <stop offset="1" stop-color="#5b5ff0"/>
    </linearGradient>
  </defs>

  <!-- Glossy orb -->
  <circle cx="64" cy="64" r="61" fill="url(#orb)"/>
  <circle cx="64" cy="64" r="60" fill="none" stroke="rgba(255,255,255,0.12)" stroke-width="2"/>
  <ellipse cx="64" cy="32" rx="42" ry="19" fill="url(#sheen)"/>

  <!-- Document sheet with folded corner -->
  <path d="M45 30h26.5L86 44.5V90a6 6 0 0 1-6 6H45a6 6 0 0 1-6-6V36a6 6 0 0 1 6-6z"
        fill="#f5f7fb"/>
  <path d="M71.5 30L86 44.5H75.5a4 4 0 0 1-4-4V30z" fill="#c7d0e2"/>

  <!-- Text lines -->
  <rect x="47" y="54" width="24" height="4.5" rx="2.25" fill="#a9b4c9"/>
  <rect x="47" y="65" width="30" height="4.5" rx="2.25" fill="#a9b4c9"/>
  <rect x="47" y="76" width="20" height="4.5" rx="2.25" fill="#c4cddd"/>

  <!-- Export badge -->
  <circle cx="85" cy="86" r="15" fill="url(#badge)" stroke="rgba(12,15,22,0.55)" stroke-width="3"/>
  <path d="M85 78.5v10.5" stroke="#ffffff" stroke-width="3.6" stroke-linecap="round"/>
  <path d="M79.5 84.5l5.5 5.5 5.5-5.5" fill="none" stroke="#ffffff"
        stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round"/>
</svg>
`;

const SIZES = [16, 32, 48, 64, 128];

for (const size of SIZES) {
  const png = await sharp(Buffer.from(ICON_SVG), { density: (72 * size) / 128 })
    .resize(size, size)
    .png()
    .toBuffer();
  writeFileSync(join(outDir, `${size}.png`), png);
  console.log(`Created icon/${size}.png (${png.length} bytes)`);
}
