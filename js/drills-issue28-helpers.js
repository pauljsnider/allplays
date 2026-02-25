export function mergeUniqueDrills(communityDrills = [], publishedDrills = []) {
    const byId = new Map();
    [...communityDrills, ...publishedDrills].forEach((drill) => {
        if (!drill?.id) return;
        byId.set(drill.id, drill);
    });
    return [...byId.values()].sort((a, b) => (a.title || '').localeCompare(b.title || ''));
}

export function linkifySafeText(text, escapeFn) {
    const escaped = escapeFn ? escapeFn(text || '') : String(text || '');
    return escaped.replace(
        /(https?:\/\/[^\s<]+)/g,
        '<a href="$1" target="_blank" rel="noopener noreferrer" class="text-primary-600 underline break-all">$1</a>'
    );
}

// Inline markdown: bold, italic, code, links. Operates on already-HTML-escaped text.
function applyInlineMd(text) {
    // Bold: **text**
    text = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    // Italic: *text* (not list bullets — requires non-space after opening *)
    text = text.replace(/\*([^\s*][^*]*?)\*/g, '<em>$1</em>');
    // Inline code: `code`
    text = text.replace(/`([^`]+)`/g, '<code class="font-mono text-xs opacity-80">$1</code>');
    // URLs
    text = text.replace(
        /(https?:\/\/[^\s<]+)/g,
        '<a href="$1" target="_blank" rel="noopener noreferrer" class="underline opacity-80 hover:opacity-100 break-all">$1</a>'
    );
    return text;
}

// Converts markdown text to safe HTML. escapeFn should be the page's escapeHtml.
export function parseMarkdown(text, escapeFn) {
    const raw = escapeFn ? escapeFn(text || '') : String(text || '');
    if (!raw) return '';
    const lines = raw.split('\n');
    const out = [];
    let i = 0;

    while (i < lines.length) {
        const line = lines[i];

        // Blank line → small spacer
        if (line.trim() === '') {
            out.push('<div class="h-1"></div>');
            i++;
            continue;
        }

        // ATX headings: ## Heading
        const hMatch = line.match(/^(#{1,4})\s+(.+)$/);
        if (hMatch) {
            const lvl = hMatch[1].length;
            const cls = lvl === 1 ? 'font-bold text-base mt-2' : 'font-semibold text-sm mt-2';
            out.push(`<div class="${cls}">${applyInlineMd(hMatch[2])}</div>`);
            i++;
            continue;
        }

        // Ordered list
        if (/^\d+\.\s/.test(line)) {
            const items = [];
            while (i < lines.length && /^\d+\.\s/.test(lines[i])) {
                items.push(`<li>${applyInlineMd(lines[i].replace(/^\d+\.\s+/, ''))}</li>`);
                i++;
            }
            out.push(`<ol class="list-decimal list-outside ml-4 space-y-0.5">${items.join('')}</ol>`);
            continue;
        }

        // Unordered list: - or * followed by whitespace
        if (/^[-*]\s/.test(line)) {
            const items = [];
            while (i < lines.length && /^[-*]\s/.test(lines[i])) {
                items.push(`<li>${applyInlineMd(lines[i].replace(/^[-*]\s+/, ''))}</li>`);
                i++;
            }
            out.push(`<ul class="list-disc list-outside ml-4 space-y-0.5">${items.join('')}</ul>`);
            continue;
        }

        // Paragraph
        out.push(`<p class="leading-snug">${applyInlineMd(line)}</p>`);
        i++;
    }

    return out.join('');
}

