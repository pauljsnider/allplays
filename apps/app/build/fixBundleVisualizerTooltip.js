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

const BROKEN_FILTER_THROTTLE = `  const throttleFilter = (callback, limit) => {
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

const FIXED_FILTER_THROTTLE = `  const throttleFilter = (callback, limit) => {
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

export function fixBundleVisualizerTooltip(html) {
    let patchedHtml = html;

    if (patchedHtml.includes(BROKEN_TOOLTIP_HANDLER)) {
        patchedHtml = patchedHtml.replace(BROKEN_TOOLTIP_HANDLER, FIXED_TOOLTIP_HANDLER);
    }

    if (patchedHtml.includes(BROKEN_FILTER_THROTTLE)) {
        patchedHtml = patchedHtml.replace(BROKEN_FILTER_THROTTLE, FIXED_FILTER_THROTTLE);
    }

    return patchedHtml;
}

export function patchBundleVisualizerTooltipFile(filePath) {
    const html = readFileSync(filePath, 'utf8');
    const patchedHtml = fixBundleVisualizerTooltip(html);

    if (patchedHtml !== html) {
        writeFileSync(filePath, patchedHtml);
    }

    return patchedHtml !== html;
}
