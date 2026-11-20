import { it, expect } from 'vitest';
import { boundedMap } from '../../js/bounded-map.js';
it('bounds concurrent requests and preserves every result in input order', async () => {
    let active = 0, peak = 0;
    const values = Array.from({length:30}, (_, i) => i);
    const results = await boundedMap(values, async (i) => {
        active++; peak = Math.max(peak, active);
        await new Promise(resolve => setTimeout(resolve, (i % 3) + 1));
        active--; return i * 2;
    }, 4);
    expect(peak).toBe(4);
    expect(results).toEqual(values.map(i => i * 2));
});
it('handles empty work and propagates failure rather than partial success', async () => {
    expect(await boundedMap([], () => {throw Error('unexpected');})).toEqual([]);
    await expect(boundedMap([1], () => {throw Error('read failed');})).rejects.toThrow('read failed');
});
