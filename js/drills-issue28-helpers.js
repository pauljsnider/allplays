export function mergeUniqueDrills(communityDrills = [], publishedDrills = []) {
    const byId = new Map();
    [...communityDrills, ...publishedDrills].forEach((drill) => {
        if (!drill?.id) return;
        byId.set(drill.id, drill);
    });
    return [...byId.values()].sort((a, b) => (a.title || '').localeCompare(b.title || ''));
}

const URL_CANDIDATE_RE = /\bhttps?:\/\/[^\s<>"']+/gi;

function isValidHostname(hostname) {
    if (!hostname) return false;
    const lower = hostname.toLowerCase();
    if (lower === 'localhost') return true;
    if (hostname.includes(':')) return true;
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) return true;
    if (hostname.startsWith('.') || hostname.endsWith('.') || hostname.includes('..')) return false;
    const labels = hostname.split('.');
    return labels.every((label) => /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label));
}

function isValidHttpUrl(value) {
    try {
        const parsed = new URL(value);
        if (!['http:', 'https:'].includes(parsed.protocol)) return false;
        return isValidHostname(parsed.hostname);
    } catch {
        return false;
    }
}

function splitTrailingPunctuation(match) {
    const trailingChars = [];
    let candidate = match;

    while (candidate.length > 0 && /[),.;!?]$/.test(candidate)) {
        const trimmed = candidate.slice(0, -1);
        if (!isValidHttpUrl(trimmed)) break;
        trailingChars.unshift(candidate.slice(-1));
        candidate = trimmed;
    }

    return { candidate, trailing: trailingChars.join('') };
}

function linkifyEscapedText(escapedText, linkClass) {
    return escapedText.replace(URL_CANDIDATE_RE, (match) => {
        const { candidate, trailing } = splitTrailingPunctuation(match);
        if (!isValidHttpUrl(candidate)) return match;
        return `<a href="${candidate}" target="_blank" rel="noopener noreferrer" class="${linkClass}">${candidate}</a>${trailing}`;
    });
}

export function linkifySafeText(text, escapeFn) {
    const escaped = escapeFn ? escapeFn(text || '') : String(text || '');
    return linkifyEscapedText(
        escaped,
        'text-primary-600 underline break-all'
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
    text = linkifyEscapedText(text, 'underline opacity-80 hover:opacity-100 break-all');
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
