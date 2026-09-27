import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import * as fontkit from 'fontkit';
import sharp from 'sharp';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const font = fontkit.openSync(path.join(root, 'node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2'));
const output = path.join(root, 'store/app-store/en-US/screenshots');

const screenshotSets = [
  {
    directory: 'iphone-6.9',
    width: 1320,
    height: 2868,
    screen: { left: 100, top: 380, width: 1120, height: 2424 },
    headlineSize: 62,
    subtitleSize: 30,
    headlineBaseline: 205,
    subtitleBaseline: 290,
    screenshots: [
      {
        name: '01-my-teams.png',
        source: 'tests/smoke/app-teams.spec.js-snapshots/my-teams-mobile.png',
        headline: 'Every team. One organized season.',
        subtitle: 'Schedules, rosters, messages, and updates—together.'
      },
      {
        name: '02-messages.png',
        source: 'tests/smoke/app-messages.spec.js-snapshots/messages-inbox-mobile.png',
        headline: 'Keep every conversation close.',
        subtitle: 'Team messages and unread updates stay easy to find.'
      }
    ]
  },
  {
    directory: 'ipad-13',
    width: 2048,
    height: 2732,
    screen: { left: 120, top: 590, width: 1808, height: 1580 },
    headlineSize: 96,
    subtitleSize: 43,
    headlineBaseline: 285,
    subtitleBaseline: 405,
    screenshots: [
      {
        name: '01-family-schedule.png',
        source: 'tests/smoke/app-schedule.spec.js-snapshots/family-schedule.png',
        headline: 'Your family schedule at a glance.',
        subtitle: 'Games, practices, RSVP needs, and packets in one view.'
      },
      {
        name: '02-discover.png',
        source: 'tests/smoke/app-discover.spec.js-snapshots/discover-opportunities.png',
        headline: 'Find the right sports opportunity.',
        subtitle: 'Explore public teams, coaching roles, and volunteer needs.'
      }
    ]
  }
];

function textPaths(text, x, baseline, size, fill) {
  const run = font.layout(text);
  const scale = size / font.unitsPerEm;
  let cursor = 0;
  return run.glyphs.map((glyph, index) => {
    const position = run.positions[index];
    const transform = `translate(${x + (cursor + position.xOffset) * scale} ${baseline - position.yOffset * scale}) scale(${scale} ${-scale})`;
    cursor += position.xAdvance;
    return `<path d="${glyph.path.toSVG()}" transform="${transform}" fill="${fill}"/>`;
  }).join('');
}

function backgroundSvg(set, screenshot) {
  const { width, height, screen } = set;
  const shadowTop = screen.top + 24;
  return Buffer.from(`
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="background" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#312e81"/>
          <stop offset="0.55" stop-color="#4f46e5"/>
          <stop offset="1" stop-color="#6d5ce7"/>
        </linearGradient>
      </defs>
      <rect width="${width}" height="${height}" fill="url(#background)"/>
      ${textPaths('ALL PLAYS', 90, 92, set.directory === 'iphone-6.9' ? 31 : 44, '#c7d2fe')}
      ${textPaths(screenshot.headline, 90, set.headlineBaseline, set.headlineSize, '#ffffff')}
      ${textPaths(screenshot.subtitle, 90, set.subtitleBaseline, set.subtitleSize, '#e0e7ff')}
      <rect x="${screen.left + 18}" y="${shadowTop}" width="${screen.width}" height="${screen.height}" rx="44" fill="#111827" opacity="0.22"/>
      <rect x="${screen.left - 10}" y="${screen.top - 10}" width="${screen.width + 20}" height="${screen.height + 20}" rx="44" fill="#ffffff" opacity="0.98"/>
    </svg>
  `);
}

async function roundedScreenshot(source, screen) {
  const image = await sharp(source)
    .resize(screen.width, screen.height, { fit: 'contain', background: '#f5f7fb' })
    .flatten({ background: '#f5f7fb' })
    .png()
    .toBuffer();
  const mask = Buffer.from(`
    <svg width="${screen.width}" height="${screen.height}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${screen.width}" height="${screen.height}" rx="34" fill="#ffffff"/>
    </svg>
  `);
  return sharp(image)
    .composite([{ input: mask, blend: 'dest-in' }])
    .png({ compressionLevel: 9 })
    .toBuffer();
}

async function generateScreenshot(set, screenshot) {
  const destinationDirectory = path.join(output, set.directory);
  await mkdir(destinationDirectory, { recursive: true });
  const source = path.join(root, screenshot.source);
  const framed = await roundedScreenshot(source, set.screen);
  await sharp(backgroundSvg(set, screenshot))
    .composite([{ input: framed, left: set.screen.left, top: set.screen.top }])
    .flatten({ background: '#312e81' })
    .removeAlpha()
    .png({ compressionLevel: 9 })
    .toFile(path.join(destinationDirectory, screenshot.name));
}

export async function generateAppStoreAssets() {
  for (const set of screenshotSets) {
    for (const screenshot of set.screenshots) {
      await generateScreenshot(set, screenshot);
    }
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  await generateAppStoreAssets();
  process.stdout.write(`Generated App Store screenshots in ${output}\n`);
}
