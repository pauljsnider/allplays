import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import sharp from 'sharp';
import * as fontkit from 'fontkit';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'store/google-play/en-US/graphics');
const iconSource = path.join(root, 'ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png');
const featureFont = path.join(root, 'node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2');
const screenshotSources = [
  ['01-my-teams.png', path.join(root, 'tests/smoke/app-teams.spec.js-snapshots/my-teams-mobile.png')],
  ['02-messages.png', path.join(root, 'tests/smoke/app-messages.spec.js-snapshots/messages-inbox-mobile.png')]
];

async function generateIcon() {
  const icon = await sharp(iconSource)
    .resize(512, 512, { fit: 'contain' })
    .ensureAlpha()
    .png({ compressionLevel: 9 })
    .toBuffer();
  await sharp(icon).toFile(path.join(output, 'icon.png'));
  return icon;
}

async function generateFeatureGraphic(icon) {
  const font = fontkit.openSync(featureFont);
  const textPath = (text, x, baseline, size) => {
    const run = font.layout(text);
    const scale = size / font.unitsPerEm;
    let cursor = 0;
    return run.glyphs.map((glyph, index) => {
      const position = run.positions[index];
      const transform = `translate(${x + (cursor + position.xOffset) * scale} ${baseline - position.yOffset * scale}) scale(${scale} ${-scale})`;
      cursor += position.xAdvance;
      return `<path d="${glyph.path.toSVG()}" transform="${transform}"/>`;
    }).join('');
  };
  const backdrop = Buffer.from(`
    <svg width="1024" height="500" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="background" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stop-color="#4037b7"/>
          <stop offset="1" stop-color="#6d53e0"/>
        </linearGradient>
      </defs>
      <rect width="1024" height="500" fill="url(#background)"/>
      <rect x="54" y="65" width="324" height="370" rx="56" fill="#f8fafc"/>
      <g fill="#ffffff">${textPath('One place for', 430, 188, 54)}</g>
      <g fill="#ffffff">${textPath('every play.', 430, 250, 54)}</g>
      <g fill="#e8e7ff">${textPath('Schedules  •  Teams  •  Game day', 434, 323, 25)}</g>
    </svg>
  `);
  const mark = await sharp(icon).resize(285, 285, { fit: 'contain' }).png().toBuffer();
  await sharp(backdrop)
    .composite([{ input: mark, left: 74, top: 108 }])
    .flatten({ background: '#4037b7' })
    .removeAlpha()
    .png({ compressionLevel: 9 })
    .toFile(path.join(output, 'feature-graphic.png'));
}

async function generateScreenshot(name, source) {
  await sharp(source)
    .resize(1080, 1920, {
      fit: 'contain',
      background: '#f5f7fb'
    })
    .flatten({ background: '#f5f7fb' })
    .removeAlpha()
    .png({ compressionLevel: 9 })
    .toFile(path.join(output, name));
}

export async function generateAssets() {
  await mkdir(output, { recursive: true });
  const icon = await generateIcon();
  await generateFeatureGraphic(icon);
  for (const [name, source] of screenshotSources) {
    await generateScreenshot(name, source);
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  await generateAssets();
  process.stdout.write(`Generated Google Play assets in ${output}\n`);
}
