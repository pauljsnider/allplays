import { describe, expect, it } from 'vitest';

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

describe('bundle visualizer tooltip patch', () => {
    it('replaces the document-level hover hide handler with a guarded version', () => {
        const patchedHtml = fixBundleVisualizerTooltip(brokenVisualizerHtml);

        expect(patchedHtml).not.toContain('const handleMouseOut = () => {');
        expect(patchedHtml).toContain('const handleMouseOut = (event) => {');
        expect(patchedHtml).toContain('target.closest(".node") || target.closest(".tooltip")');
        expect(patchedHtml).toContain('document.addEventListener("mouseover", handleMouseOut);');
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
  }, []);`;

        expect(fixBundleVisualizerTooltip(patchedHtml)).toBe(patchedHtml);
    });
});
