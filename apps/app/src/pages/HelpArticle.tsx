import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Home, Search } from 'lucide-react';
import { getHelpKnowledgeDocs } from '../lib/helpKnowledgeService';

export function HelpArticle() {
  const { helpId = '' } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const helpPortalState = normalizeHelpPortalState(location.state);
  const helpDoc = getHelpKnowledgeDocs().find((doc) => doc.id === helpId);

  if (!helpDoc) {
    return (
      <div className="space-y-4">
        <BackButton helpPortalState={helpPortalState} />
        <section className="app-card p-5 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-primary-50 text-primary-700">
            <Search className="h-5 w-5" aria-hidden="true" />
          </div>
          <h1 className="mt-3 text-2xl font-black text-gray-950">Help article not found</h1>
          <p className="mt-2 text-sm font-semibold leading-6 text-gray-600">
            This help article is not packaged in the app yet. Try another search result or head back home.
          </p>
          <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-center">
            {helpPortalState.fromHelpPortal ? (
              <button
                type="button"
                className="primary-button justify-center"
                onClick={() => navigate('/help', { state: helpPortalState })}
              >
                Back to Help Portal
              </button>
            ) : (
              <button type="button" className="primary-button justify-center" onClick={() => navigate(-1)}>
                Back to search
              </button>
            )}
            <Link to="/home" className="ghost-button justify-center">
              <Home className="h-4 w-4" aria-hidden="true" />
              Home
            </Link>
          </div>
        </section>
      </div>
    );
  }

  const articleBlocks = buildArticleBlocks(helpDoc.text, helpDoc.title, helpDoc.summary);

  return (
    <div className="space-y-4">
      <BackButton helpPortalState={helpPortalState} />

      <article className="app-card overflow-hidden">
        <header className="border-b border-gray-200 bg-gradient-to-r from-primary-50 to-white p-5">
          <div className="text-xs font-extrabold uppercase tracking-[0.04em] text-primary-700">Help article</div>
          <h1 className="mt-2 text-2xl font-black text-gray-950">{helpDoc.title}</h1>
          <p className="mt-2 text-sm font-semibold leading-6 text-gray-600">{helpDoc.summary}</p>
          {helpDoc.roles.length ? (
            <div className="mt-3 flex flex-wrap gap-2" aria-label="Help roles">
              {helpDoc.roles.map((role) => (
                <span key={role} className="rounded-full bg-white px-3 py-1 text-[11px] font-extrabold uppercase tracking-[0.04em] text-gray-600 shadow-sm ring-1 ring-gray-200">
                  {role}
                </span>
              ))}
            </div>
          ) : null}
        </header>

        <div className="space-y-5 p-5 text-sm font-semibold leading-7 text-gray-700">
          {articleBlocks.map((block, index) => (
            <ArticleBlock key={`${getBlockKeyText(block).slice(0, 24)}-${index}`} block={block} />
          ))}
        </div>
      </article>
    </div>
  );
}

function BackButton({ helpPortalState }: { helpPortalState: ReturnType<typeof normalizeHelpPortalState> }) {
  const navigate = useNavigate();

  const handleBack = () => {
    if (helpPortalState.fromHelpPortal) {
      navigate('/help', { state: helpPortalState });
      return;
    }
    navigate(-1);
  };

  return (
    <button type="button" className="ghost-button" onClick={handleBack}>
      <ArrowLeft className="h-4 w-4" aria-hidden="true" />
      {helpPortalState.fromHelpPortal ? 'Back to Help Portal' : 'Back'}
    </button>
  );
}

function normalizeHelpPortalState(state: unknown) {
  const candidate = state as { fromHelpPortal?: boolean; helpQuery?: string; helpRoleFilter?: string } | null;

  return {
    fromHelpPortal: candidate?.fromHelpPortal === true,
    helpQuery: typeof candidate?.helpQuery === 'string' ? candidate.helpQuery : '',
    helpRoleFilter: typeof candidate?.helpRoleFilter === 'string' ? candidate.helpRoleFilter : 'all'
  };
}

type ArticleContentBlock =
  | { type: 'heading'; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'list'; items: string[] };

function ArticleBlock({ block }: { block: ArticleContentBlock }) {
  if (block.type === 'heading') {
    return <h2 className="text-base font-black text-gray-950">{block.text}</h2>;
  }

  if (block.type === 'list') {
    return (
      <ul className="ml-5 list-disc space-y-2">
        {block.items.map((item, index) => (
          <li key={`${item.slice(0, 24)}-${index}`}>{item}</li>
        ))}
      </ul>
    );
  }

  return <p>{block.text}</p>;
}

function getBlockKeyText(block: ArticleContentBlock) {
  return block.type === 'list' ? block.items.join(' ') : block.text;
}

function buildArticleBlocks(text: string, title: string, summary: string): ArticleContentBlock[] {
  const titlePattern = escapeRegExp(title);
  const summaryPattern = escapeRegExp(summary);
  const cleaned = String(text || '')
    .replace(new RegExp(`^${titlePattern}\\s+${summaryPattern}\\s*`, 'i'), '')
    .replace(/Help\s+-\s+[^←\n]+(?:\s|[\n])+←\s+Back to Help Portal\s*/i, '')
    .replace(new RegExp(`^${titlePattern}\\s+${summaryPattern}\\s*`, 'i'), '')
    .split(/\n+/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
    .trim();

  const lines = discardGeneratedSearchPreamble(cleaned.split(/\n+/).map((line) => line.trim()).filter(Boolean));
  if (!lines.length) return [{ type: 'paragraph', text: summary }];

  const blocks: ArticleContentBlock[] = [];
  let listItems: string[] = [];

  const flushList = () => {
    if (!listItems.length) return;
    blocks.push({ type: 'list', items: listItems });
    listItems = [];
  };

  lines.forEach((line) => {
    if (
      line === title
      || line === summary
      || /^Help\s+-\s+/i.test(line)
      || /^←\s+Back to Help (?:Portal|Center)/i.test(line)
      || line === 'Workflow Guide'
      || line === 'On this page'
      || /^Updated from /i.test(line)
    ) {
      return;
    }

    if (line.startsWith('- ')) {
      listItems.push(line.slice(2).trim());
      return;
    }

    flushList();
    blocks.push({
      type: isLikelyArticleHeading(line) ? 'heading' : 'paragraph',
      text: line
    });
  });

  flushList();

  if (blocks.length > 1) {
    return blocks.slice(0, 36);
  }

  return splitRunOnParagraphs(blocks[0] ? getBlockKeyText(blocks[0]) : summary).map((paragraph) => ({
    type: 'paragraph',
    text: paragraph
  }));
}

function discardGeneratedSearchPreamble(lines: string[]) {
  const workflowGuideIndex = lines.findIndex((line) => line === 'Workflow Guide');
  if (workflowGuideIndex === -1) return lines;

  const articleStartIndex = workflowGuideIndex + 1;
  return articleStartIndex < lines.length ? lines.slice(articleStartIndex) : lines;
}

function isLikelyArticleHeading(line: string) {
  return line.length <= 80
    && !/[.!?:]$/.test(line)
    && /\b[A-Z][a-z]+\b/.test(line)
    && line.split(/\s+/).length <= 8;
}

function splitRunOnParagraphs(text: string) {
  const chunks = text
    .split(/(?<=[.!?])\s+/)
    .map((chunk) => chunk.trim())
    .filter(Boolean);

  if (!chunks.length) return [text];

  const paragraphs: string[] = [];
  for (let index = 0; index < chunks.length; index += 2) {
    paragraphs.push(chunks.slice(index, index + 2).join(' '));
  }

  return paragraphs.slice(0, 24);
}

function escapeRegExp(value: string) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
