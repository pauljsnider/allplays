import { readFileSync, writeFileSync } from 'node:fs';

const BROKEN_TOOLTIP_HANDLER = `          const handleMouseOut = () => {
              setShowTooltip(false);
          };
          document.addEventListener("mouseover", handleMouseOut);
          return () => {
              document.removeEventListener("mouseover", handleMouseOut);
          };`;

const FIXED_TOOLTIP_HANDLER = `          const handleMouseOut = (event) => {
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

export function fixBundleVisualizerTooltip(html) {
    if (!html.includes(BROKEN_TOOLTIP_HANDLER)) {
        return html;
    }

    return html.replace(BROKEN_TOOLTIP_HANDLER, FIXED_TOOLTIP_HANDLER);
}

export function patchBundleVisualizerTooltipFile(filePath) {
    const html = readFileSync(filePath, 'utf8');
    const patchedHtml = fixBundleVisualizerTooltip(html);

    if (patchedHtml !== html) {
        writeFileSync(filePath, patchedHtml);
    }

    return patchedHtml !== html;
}
