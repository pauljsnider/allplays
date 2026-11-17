import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

it('keeps a viewport-height fallback before dynamic viewport units', () => {
    const html = readFileSync(new URL('../../live-game-overlay.html', import.meta.url), 'utf8');
    const stageRule = html.match(/\.broadcast-stage\s*\{([^}]+)\}/)?.[1];
    expect(stageRule).toMatch(/height:\s*100vh;[\s\S]*height:\s*100dvh;/);
});
