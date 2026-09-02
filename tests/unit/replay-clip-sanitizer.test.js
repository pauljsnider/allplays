import { describe, expect, it } from 'vitest';
import { transformReplayClipValue } from '../../js/replay-clip-sanitizer.js';

describe('bounded replay clip sanitizer', () => {
    it('removes sensitive properties regardless of their value type', () => {
        const input = {
            linkedBy: { uid: 'deleted.uid' },
            nested: { updatedBy: ['deleted.uid'], title: 'Keep' }
        };

        expect(transformReplayClipValue(input, {
            onProperty: (_value, { key }) => key === 'linkedBy' || key === 'updatedBy'
        }).value).toEqual({ nested: { title: 'Keep' } });
    });

    it('recurses through maps and arrays while preserving unrelated metadata', () => {
        const input = [{
            id: 'clip-1',
            asset: {
                sources: [
                    { url: 'https://youtu.be/PK1HyC37doc', label: 'protected' },
                    { url: 'https://cdn.example/clip.mp4', label: 'standalone' }
                ]
            }
        }];

        const result = transformReplayClipValue(input, {
            onString: (value) => value.includes('PK1HyC37doc')
        });

        expect(result.changed).toBe(true);
        expect(result.value).toEqual([{
            id: 'clip-1',
            asset: {
                sources: [
                    { label: 'protected' },
                    { url: 'https://cdn.example/clip.mp4', label: 'standalone' }
                ]
            }
        }]);
    });

    it.each([
        ['depth', (() => {
            let value = 'leaf';
            for (let index = 0; index < 21; index += 1) value = { child: value };
            return value;
        })(), { maxDepth: 20 }],
        ['nodes', [{ value: 'one' }, { value: 'two' }], { maxNodes: 2 }],
        ['string', 'x'.repeat(2_049), { maxStringLength: 2_048 }]
    ])('fails closed when the %s bound is exceeded', (_label, value, limits) => {
        expect(() => transformReplayClipValue(value, limits)).toThrow(/Replay clip traversal/);
    });

    it('fails closed on cyclic values', () => {
        const value = {};
        value.self = value;
        expect(() => transformReplayClipValue(value)).toThrow(/cyclic value/);
    });
});
