import { describe, expect, it, vi } from 'vitest';

import { fixBundleVisualizerTooltip } from '../../apps/app/build/fixBundleVisualizerTooltip.js';

const brokenVisualizerHtml = `  y(() => {
          const handleMouseOut = () => {
              setShowTooltip(false);
          };
          document.addEventListener("mouseover", handleMouseOut);
          return () => {
              document.removeEventListener("mouseover", handleMouseOut);
          };
  }, []);`;

describe('bundle visualizer patch', () => {
    it('replaces the document-level hover hide handler with a guarded version', () => {
        const patchedHtml = fixBundleVisualizerTooltip(brokenVisualizerHtml);

        expect(patchedHtml).not.toContain('const handleMouseOut = () => {');
        expect(patchedHtml).toContain('const handleMouseOut = (event) => {');
        expect(patchedHtml).toContain('target.closest(".node") || target.closest(".tooltip")');
        expect(patchedHtml).toContain('document.addEventListener("mouseover", handleMouseOut);');
    });

    it('adds a trailing filter update so the final typed value is not dropped', () => {
        const brokenFilterHtml = `  const throttleFilter = (callback, limit) => {
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

        const patchedHtml = fixBundleVisualizerTooltip(brokenFilterHtml);
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

    it('leaves already-patched reports unchanged', () => {
        const patchedHtml = `  y(() => {
      const handleMouseOut = (event) => {
          const target = event.target;
          if (target instanceof Element && (target.closest(".node") || target.closest(".tooltip"))) {
              return;
          }
          setShowTooltip(false);
      };
      document.addEventListener("mouseover", handleMouseOut);
      return () => {
          document.removeEventListener("mouseover", handleMouseOut);
      };
  }, []);

  const throttleFilter = (callback, limit) => {
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

        expect(fixBundleVisualizerTooltip(patchedHtml)).toBe(patchedHtml);
    });
});
