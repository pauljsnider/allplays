import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import { describe, expect, it, vi } from 'vitest';

import {
    assertBundleVisualizerTooltipPatched,
    fixBundleVisualizerTooltip,
    patchBundleVisualizerTooltipFile
} from '../../apps/app/build/fixBundleVisualizerTooltip.js';

const brokenTooltipHandler = `          const handleMouseOut = () => {
              setShowTooltip(false);
          };
          document.addEventListener("mouseover", handleMouseOut);
          return () => {
              document.removeEventListener("mouseover", handleMouseOut);
          };`;

const fixedTooltipHandler = `          const handleMouseOut = (event) => {
              const target = event.target;
              if (target instanceof Element && (target.closest(".node") || target.closest(".tooltip"))) {
                  return;
              }
              setShowTooltip(false);
          };
          document.addEventListener("mouseover", handleMouseOut);
          return () => {
              document.removeEventListener("mouseover", handleMouseOut);
          };`;

const brokenFilterThrottle = `  const throttleFilter = (callback, limit) => {
      let waiting = false;
      return (val) => {
          if (!waiting) {
              callback(val);
              waiting = true;
              setTimeout(() => {
                  waiting = false;
              }, limit);
          }
      };
  };`;

const fixedFilterThrottle = `  const throttleFilter = (callback, limit) => {
      let waiting = false;
      let latestValue;
      let lastEmittedValue;
      return (val) => {
          latestValue = val;
          if (!waiting) {
              callback(val);
              lastEmittedValue = val;
              waiting = true;
              setTimeout(() => {
                  waiting = false;
                  if (latestValue !== lastEmittedValue) {
                      callback(latestValue);
                      lastEmittedValue = latestValue;
                  }
              }, limit);
          }
      };
  };`;

const artifactFixturePath = path.resolve(import.meta.dirname, '../fixtures/app-bundle-visualizer.fixture.html');

function readArtifactFixtureHtml() {
    if (!existsSync(artifactFixturePath)) {
        throw new Error(`Missing bundle visualizer fixture: ${artifactFixturePath}`);
    }

    return readFileSync(artifactFixturePath, 'utf8');
}

function buildBrokenArtifactHtml() {
    return readArtifactFixtureHtml()
        .replace(fixedTooltipHandler, brokenTooltipHandler)
        .replace(fixedFilterThrottle, brokenFilterThrottle);
}

async function loadVisualizerDocument(html) {
    const dom = new JSDOM(html, {
        pretendToBeVisual: true,
        resources: 'usable',
        runScripts: 'dangerously',
        url: 'http://localhost/'
    });

    await new Promise((resolve) => setTimeout(resolve, 100));

    return dom;
}

describe('bundle visualizer patch', () => {
    it('replaces the document-level hover hide handler with a guarded version', () => {
        const patchedHtml = fixBundleVisualizerTooltip(`  y(() => {
${brokenTooltipHandler}
  }, []);`);

        expect(patchedHtml).not.toContain('const handleMouseOut = () => {');
        expect(patchedHtml).toContain('const handleMouseOut = (event) => {');
        expect(patchedHtml).toContain('target.closest(".node") || target.closest(".tooltip")');
        expect(patchedHtml).toContain('document.addEventListener("mouseover", handleMouseOut);');
    });

    it('adds a trailing filter update so the final typed value is not dropped', () => {
        const patchedHtml = fixBundleVisualizerTooltip(brokenFilterThrottle);
        const throttleFilter = new Function(`${patchedHtml}; return throttleFilter;`)();
        const values = [];
        const throttled = throttleFilter((value) => values.push(value), 200);

        vi.useFakeTimers();
        try {
            throttled('v');
            throttled('ve');
            throttled('ven');

            expect(values).toEqual(['v']);

            vi.advanceTimersByTime(200);

            expect(values).toEqual(['v', 'ven']);
        } finally {
            vi.useRealTimers();
        }
    });

    it('patches a real bundle visualizer artifact file in place', () => {
        const tempDirectory = mkdtempSync(path.join(tmpdir(), 'bundle-visualizer-'));
        const tempFilePath = path.join(tempDirectory, 'bundle-visualizer.html');

        try {
            writeFileSync(tempFilePath, buildBrokenArtifactHtml());

            expect(patchBundleVisualizerTooltipFile(tempFilePath)).toBe(true);

            const patchedHtml = readFileSync(tempFilePath, 'utf8');

            expect(patchedHtml).not.toBe(buildBrokenArtifactHtml());
            expect(patchedHtml).toContain(fixedTooltipHandler);
            expect(patchedHtml).toContain(fixedFilterThrottle);
        } finally {
            rmSync(tempDirectory, { force: true, recursive: true });
        }
    });

    it('preserves tooltip hover state and applies the final throttled filter value in the rendered report', async () => {
        const patchedHtml = fixBundleVisualizerTooltip(buildBrokenArtifactHtml());
        const dom = await loadVisualizerDocument(patchedHtml);

        try {
            const { document, Event, MouseEvent } = dom.window;
            const firstNode = document.querySelector('.node');
            const tooltip = document.querySelector('.tooltip');
            const includeInput = document.querySelector('#module-filter-include');

            expect(firstNode).toBeTruthy();
            expect(tooltip).toBeTruthy();
            expect(includeInput).toBeTruthy();

            firstNode.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
            await new Promise((resolve) => setTimeout(resolve, 0));
            expect(tooltip.className).not.toContain('tooltip-hidden');

            tooltip.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
            await new Promise((resolve) => setTimeout(resolve, 0));
            expect(tooltip.className).not.toContain('tooltip-hidden');

            includeInput.value = '**/react/**';
            includeInput.dispatchEvent(new Event('input', { bubbles: true }));
            includeInput.value = '**/react-dom/**';
            includeInput.dispatchEvent(new Event('input', { bubbles: true }));

            await new Promise((resolve) => setTimeout(resolve, 250));

            expect(document.querySelectorAll('.node')).toHaveLength(5);
            expect(document.querySelector('svg')?.textContent).toContain('react-dom');
        } finally {
            dom.window.close();
        }
    });

    it('leaves already-patched reports unchanged', () => {
        const artifactFixtureHtml = readArtifactFixtureHtml();

        expect(fixBundleVisualizerTooltip(artifactFixtureHtml)).toBe(artifactFixtureHtml);
    });

    it('fails loudly when upstream visualizer output no longer contains the expected patch anchors', () => {
        expect(() => assertBundleVisualizerTooltipPatched('<html><body>new template</body></html>'))
            .toThrow(/rollup-plugin-visualizer template may have changed/);
    });

    it('runs the real generated-artifact interaction verifier after every app build', () => {
        const packageSource = readFileSync(new URL('../../package.json', import.meta.url), 'utf8');
        const verifierSource = readFileSync(
            new URL('../../scripts/verify-app-bundle-visualizer.mjs', import.meta.url),
            'utf8'
        );

        expect(packageSource).toContain('npm --prefix apps/app run build && node scripts/verify-app-bundle-visualizer.mjs');
        expect(verifierSource).toContain("path.join(repoRoot, 'apps/app/bundle-visualizer.html')");
        expect(verifierSource).toContain("document.querySelector('.node')");
        expect(verifierSource).toContain("document.querySelector('.tooltip')");
        expect(verifierSource).toContain("document.querySelector('#module-filter-include')");
        expect(verifierSource).toContain("includeInput.value = '**/react-dom/**';");
        expect(verifierSource).toContain("document.querySelector('svg')?.textContent.includes('react-dom')");
    });
});
