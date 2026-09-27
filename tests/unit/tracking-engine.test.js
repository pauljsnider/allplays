import { describe, expect, it } from 'vitest';
import { isLegacyTrackingEngine } from '../../js/tracking-engine.js';

describe('legacy tracking engine compatibility', () => {
    it.each([
        ['missing', undefined],
        ['null', null],
        ['empty', ''],
        ['legacy', 'legacy'],
        ['legacy-v1', 'legacy-v1'],
        ['classic', 'classic'],
        ['standard', 'standard']
    ])('accepts the %s engine as legacy', (_label, engine) => {
        expect(isLegacyTrackingEngine(engine)).toBe(true);
    });

    it.each([
        ['future engine', 'future-engine'],
        ['Diamond v2', 'diamond-v2'],
        ['wrong case', 'Legacy'],
        ['whitespace-padded alias', ' legacy '],
        ['non-string false value', false]
    ])('fails closed for a %s', (_label, engine) => {
        expect(isLegacyTrackingEngine(engine)).toBe(false);
    });
});
