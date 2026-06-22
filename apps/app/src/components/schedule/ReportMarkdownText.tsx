import { Fragment, type ReactNode } from 'react';

export function ReportMarkdownText({ text, compact = false }: { text: string; compact?: boolean }) {
  const lines = String(text || '').split(/\r?\n/);
  const blocks: ReactNode[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    const trimmed = line.trim();

    if (!trimmed) {
      index += 1;
      continue;
    }

    const headingMatch = trimmed.match(/^(#{1,4})\s+(.+)$/);
    if (headingMatch) {
      blocks.push(
        <div key={`heading-${index}`} className="pt-1 text-sm font-black text-gray-950">
          {renderReportInlineMarkdown(headingMatch[2], `heading-${index}`)}
        </div>
      );
      index += 1;
      continue;
    }

    if (/^\d+\.\s+/.test(trimmed)) {
      const items: ReactNode[] = [];
      while (index < lines.length && /^\d+\.\s+/.test(lines[index].trim())) {
        const item = lines[index].trim().replace(/^\d+\.\s+/, '');
        items.push(<li key={`ordered-${index}`}>{renderReportInlineMarkdown(item, `ordered-${index}`)}</li>);
        index += 1;
      }
      blocks.push(<ol key={`ordered-list-${index}`} className="list-decimal space-y-1 pl-5">{items}</ol>);
      continue;
    }

    if (/^[-*]\s+/.test(trimmed)) {
      const items: ReactNode[] = [];
      while (index < lines.length && /^[-*]\s+/.test(lines[index].trim())) {
        const item = lines[index].trim().replace(/^[-*]\s+/, '');
        items.push(<li key={`bullet-${index}`}>{renderReportInlineMarkdown(item, `bullet-${index}`)}</li>);
        index += 1;
      }
      blocks.push(<ul key={`bullet-list-${index}`} className="list-disc space-y-1 pl-5">{items}</ul>);
      continue;
    }

    blocks.push(
      <p key={`paragraph-${index}`} className="whitespace-pre-wrap">
        {renderReportInlineMarkdown(line, `paragraph-${index}`)}
      </p>
    );
    index += 1;
  }

  return (
    <div className={`${compact ? 'mt-1 space-y-1 text-sm leading-5' : 'mt-2 space-y-2 text-sm leading-6'} font-semibold text-gray-700`}>
      {blocks}
    </div>
  );
}

function renderReportInlineMarkdown(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /(\*\*[^*]+?\*\*|__[^_]+?__|`[^`]+?`|https?:\/\/[^\s)]+)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(<Fragment key={`${keyPrefix}-text-${lastIndex}`}>{text.slice(lastIndex, match.index)}</Fragment>);
    }

    const token = match[0];
    const key = `${keyPrefix}-token-${match.index}`;
    if ((token.startsWith('**') && token.endsWith('**')) || (token.startsWith('__') && token.endsWith('__'))) {
      nodes.push(<strong key={key} className="font-black text-gray-950">{token.slice(2, -2)}</strong>);
    } else if (token.startsWith('`') && token.endsWith('`')) {
      nodes.push(<code key={key} className="rounded bg-gray-100 px-1 py-0.5 font-mono text-[0.82em] text-gray-800">{token.slice(1, -1)}</code>);
    } else {
      nodes.push(
        <a key={key} href={token} target="_blank" rel="noreferrer" className="break-all font-black text-primary-700 underline decoration-primary-200 underline-offset-2">
          {token}
        </a>
      );
    }
    lastIndex = pattern.lastIndex;
  }

  if (lastIndex < text.length) {
    nodes.push(<Fragment key={`${keyPrefix}-text-tail`}>{text.slice(lastIndex)}</Fragment>);
  }

  return nodes;
}
