// Bound concurrent reads without dropping records or changing their order.
export async function boundedMap(items, worker, concurrency = 6) {
    const results = new Array(items.length);
    let next = 0;
    const count = Math.min(items.length, Math.max(1, Math.floor(concurrency) || 1));
    await Promise.all(Array.from({ length: count }, async () => {
        while (next < items.length) {
            const index = next++;
            results[index] = await worker(items[index], index);
        }
    }));
    return results;
}
