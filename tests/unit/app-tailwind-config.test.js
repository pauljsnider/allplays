import { describe, expect, it } from 'vitest';
import tailwindConfig from '../../apps/app/tailwind.config.js';

describe('app Tailwind config', () => {
    it('defines the primary shades used by focus and selected states', () => {
        const primary = tailwindConfig.theme.extend.colors.primary;

        expect(primary).toMatchObject({
            200: '#c7d2fe',
            300: '#a5b4fc',
            400: '#818cf8',
            950: '#1e1b4b'
        });
    });
});
