import path from 'node:path';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const expectedScreenshots = [
    ['store/app-store/en-US/screenshots/iphone-6.9/01-my-teams.png', 1320, 2868],
    ['store/app-store/en-US/screenshots/iphone-6.9/02-messages.png', 1320, 2868],
    ['store/app-store/en-US/screenshots/ipad-13/01-family-schedule.png', 2048, 2732],
    ['store/app-store/en-US/screenshots/ipad-13/02-discover.png', 2048, 2732]
];

describe('App Store screenshot assets', () => {
    it.each(expectedScreenshots)('%s uses an accepted opaque PNG size', async (relativePath, width, height) => {
        const metadata = await sharp(path.join(root, relativePath)).metadata();

        expect(metadata).toMatchObject({ format: 'png', width, height, hasAlpha: false });
    });
});
