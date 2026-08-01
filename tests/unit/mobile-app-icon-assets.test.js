import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const PNG_SIGNATURE = '89504e470d0a1a0a';

function readPngHeader(relativePath) {
    const contents = readFileSync(resolve(process.cwd(), relativePath));

    expect(contents.subarray(0, 8).toString('hex')).toBe(PNG_SIGNATURE);

    return {
        contents,
        width: contents.readUInt32BE(16),
        height: contents.readUInt32BE(20),
        colorType: contents[25]
    };
}

describe('mobile app icon assets', () => {
    it('uses the same opaque 1024px store icon for the source and iOS app', () => {
        const source = readPngHeader('resources/icon.png');
        const ios = readPngHeader(
            'ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png'
        );

        expect(source).toMatchObject({ width: 1024, height: 1024, colorType: 2 });
        expect(ios).toMatchObject({ width: 1024, height: 1024, colorType: 2 });
        expect(ios.contents.equals(source.contents)).toBe(true);
    });

    it.each([
        ['mdpi', 48, 108],
        ['hdpi', 72, 162],
        ['xhdpi', 96, 216],
        ['xxhdpi', 144, 324],
        ['xxxhdpi', 192, 432]
    ])('provides complete Android %s launcher assets', (density, legacySize, foregroundSize) => {
        const base = `android/app/src/main/res/mipmap-${density}`;
        const launcher = readPngHeader(`${base}/ic_launcher.png`);
        const round = readPngHeader(`${base}/ic_launcher_round.png`);
        const foreground = readPngHeader(`${base}/ic_launcher_foreground.png`);

        expect(launcher).toMatchObject({
            width: legacySize,
            height: legacySize,
            colorType: 2
        });
        expect(round).toMatchObject({ width: legacySize, height: legacySize, colorType: 6 });
        expect(foreground).toMatchObject({
            width: foregroundSize,
            height: foregroundSize,
            colorType: 6
        });
    });

    it('uses the AllPlays background without retaining placeholder artwork', () => {
        const color = readFileSync(
            resolve(process.cwd(), 'android/app/src/main/res/values/ic_launcher_background.xml'),
            'utf8'
        );
        const drawable = readFileSync(
            resolve(process.cwd(), 'android/app/src/main/res/drawable/ic_launcher_background.xml'),
            'utf8'
        );

        expect(color).toContain('#F4F9F9');
        expect(drawable).toContain('#F4F9F9');
        expect(drawable).not.toContain('strokeColor');
        expect(
            existsSync(
                resolve(
                    process.cwd(),
                    'android/app/src/main/res/drawable-v24/ic_launcher_foreground.xml'
                )
            )
        ).toBe(false);
    });
});
