#!/usr/bin/env node
/**
 * Converts workflow-docs/*.md to workflow-*.html and rebuilds help.html
 * as a workflow-first index with search + role filter.
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const WORKFLOW_MD_DIR = path.join(ROOT, 'workflow-docs');
const HELP_HTML = path.join(ROOT, 'help.html');
const MANIFEST = path.join(ROOT, 'workflow-manifest.json');

function escapeHtml(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function slugify(value) {
    return String(value || '')
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, '')
        .trim()
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-') || 'section';
}

function parseInline(value) {
    return escapeHtml(value)
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.+?)\*/g, '<em>$1</em>');
}

function mdToHtml(md) {
    const lines = md.replace(/\r\n/g, '\n').split('\n');
    const out = [];
    let inUl = false;
    let inOl = false;
    let skippedFirstH1 = false;
    const headingCounts = new Map();

    const closeLists = () => {
        if (inUl) {
            out.push('</ul>');
            inUl = false;
        }
        if (inOl) {
            out.push('</ol>');
            inOl = false;
        }
    };

    for (const raw of lines) {
        const line = raw.trim();

        if (!line) {
            closeLists();
            continue;
        }

        const h = /^(#{1,6})\s+(.*)$/.exec(line);
        if (h) {
            closeLists();
            const level = Math.min(h[1].length, 6);
            if (level === 1 && !skippedFirstH1) {
                skippedFirstH1 = true;
                continue;
            }
            const headingText = h[2].trim();
            const baseSlug = slugify(headingText);
            const nextCount = (headingCounts.get(baseSlug) || 0) + 1;
            headingCounts.set(baseSlug, nextCount);
            const slug = nextCount > 1 ? `${baseSlug}-${nextCount}` : baseSlug;
            out.push(`<h${level} id="${slug}">${parseInline(headingText)}</h${level}>`);
            continue;
        }

        const ordered = /^\d+\.\s+(.*)$/.exec(line);
        if (ordered) {
            if (inUl) {
                out.push('</ul>');
                inUl = false;
            }
            if (!inOl) {
                out.push('<ol class="ml-6 list-decimal space-y-1">');
                inOl = true;
            }
            out.push(`<li>${parseInline(ordered[1])}</li>`);
            continue;
        }

        const bullet = /^[-*+]\s+(.*)$/.exec(line);
        if (bullet) {
            if (inOl) {
                out.push('</ol>');
                inOl = false;
            }
            if (!inUl) {
                out.push('<ul class="ml-6 list-disc space-y-1">');
                inUl = true;
            }
            out.push(`<li>${parseInline(bullet[1])}</li>`);
            continue;
        }

        closeLists();
        out.push(`<p>${parseInline(line)}</p>`);
    }

    closeLists();
    return out.join('\n');
}

function extractTitle(md, fallback) {
    const first = md.split('\n').find((l) => /^#\s+/.test(l.trim()));
    return first ? first.replace(/^#\s+/, '').trim() : fallback;
}

function summarize(md) {
    const lines = md
        .replace(/\r\n/g, '\n')
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean)
        .filter((l) => !/^#/.test(l))
        .filter((l) => !/^[-*+]\s+/.test(l))
        .filter((l) => !/^\d+\.\s+/.test(l));
    const clean = (lines[0] || md)
        .replace(/[#>*`]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    return clean.slice(0, 190);
}

function estimateReadTime(md) {
    const words = md
        .replace(/\r\n/g, '\n')
        .replace(/[`#>*]/g, ' ')
        .split(/\s+/)
        .filter(Boolean).length;
    return Math.max(2, Math.round(words / 190));
}

function extractRoles(md) {
    const lines = md.replace(/\r\n/g, '\n').split('\n');
    const roles = new Set();
    let inSection = false;

    for (const raw of lines) {
        const line = raw.trim();
        if (!line) continue;

        if (/^##\s+Who\s+Is\s+This\s+For/i.test(line)) {
            inSection = true;
            continue;
        }
        if (inSection && /^##\s+/.test(line)) {
            break;
        }
        if (!inSection) {
            continue;
        }

        const roleMatches = line.match(/\b(Parent|Parents|Coach|Coaches|Admin|Admins|Member|Members|All)\b/gi) || [];
        roleMatches.forEach((rawRole) => {
            const key = rawRole.toLowerCase();
            if (key.startsWith('parent')) roles.add('Parent');
            else if (key.startsWith('coach')) roles.add('Coach');
            else if (key.startsWith('admin')) roles.add('Admin');
            else if (key.startsWith('member')) roles.add('Member');
            else if (key === 'all') roles.add('All');
        });

        if (/all users?/i.test(line)) {
            roles.add('All');
        }
    }

    if (!roles.size) {
        return ['All'];
    }

    const order = ['All', 'Parent', 'Coach', 'Admin', 'Member'];
    return order.filter((r) => roles.has(r));
}

function buildRoleBadges(roles) {
    return (roles && roles.length ? roles : ['All'])
        .map((r) => `<span class="wf-role-chip">${escapeHtml(r)}</span>`)
        .join(' ');
}

function primaryTailwindConfig() {
    return `<script>
      tailwind.config = {
        theme: {
          extend: {
            colors: {
              primary: {
                50: '#eef2ff',
                100: '#e0e7ff',
                500: '#6366f1',
                600: '#4f46e5',
                700: '#4338ca',
                800: '#3730a3',
                900: '#312e81'
              }
            }
          }
        }
      }
    </script>`;
}

function standardChromeScript() {
    return `<script type="module">
      import { checkAuth } from './js/auth.js?v=10';
      import { renderHeader, renderFooter } from './js/utils.js?v=8';
      renderHeader(document.getElementById('header-container'), null);
      renderFooter(document.getElementById('footer-container'));
      checkAuth((user) => {
        renderHeader(document.getElementById('header-container'), user);
      });
    </script>`;
}

function renderArticle({ title, roles, bodyHtml, summary, readTimeMin }) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link rel="icon" type="image/png" href="img/logo_small.png">
    <title>${escapeHtml(title)} - ALL PLAYS Help</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link rel="stylesheet" href="css/styles.css">
    ${primaryTailwindConfig()}
    <style>
      :root {
        --wf-bg: #f8fafc;
        --wf-panel: #ffffff;
        --wf-text: #0f172a;
        --wf-muted: #52606f;
        --wf-accent: #4f46e5;
        --wf-accent-soft: #e0e7ff;
        --wf-border: #d9e2ec;
      }

      body {
        background:
          radial-gradient(circle at 85% 0%, rgba(99,102,241,0.14) 0%, rgba(248,250,252,0) 42%),
          radial-gradient(circle at 8% 20%, rgba(67,56,202,0.10) 0%, rgba(248,250,252,0) 48%),
          var(--wf-bg);
        color: var(--wf-text);
      }

      .wf-shell {
        width: min(1160px, 100%);
        margin: 0 auto;
        padding: 1.5rem 1rem 3rem;
      }

      .wf-back-link {
        display: inline-flex;
        align-items: center;
        gap: 0.4rem;
        font-size: 0.85rem;
        font-weight: 700;
        color: #4338ca;
      }

      .wf-hero {
        margin-top: 0.75rem;
        background: linear-gradient(140deg, #312e81 0%, #4338ca 46%, #4f46e5 100%);
        border-radius: 1.1rem;
        padding: 1.25rem 1.25rem 1.15rem;
        color: #ecfeff;
        box-shadow: 0 14px 36px rgba(15, 23, 42, 0.22);
      }

      .wf-kicker {
        font-size: 0.73rem;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        opacity: 0.84;
      }

      .wf-title {
        margin-top: 0.4rem;
        font-size: clamp(1.75rem, 2.8vw, 2.35rem);
        line-height: 1.15;
        font-weight: 800;
      }

      .wf-summary {
        margin-top: 0.75rem;
        max-width: 60ch;
        color: rgba(236, 254, 255, 0.95);
        line-height: 1.58;
      }

      .wf-meta-row {
        margin-top: 0.95rem;
        display: flex;
        flex-wrap: wrap;
        gap: 0.65rem;
        align-items: center;
      }

      .wf-meta-pill {
        display: inline-flex;
        align-items: center;
        font-size: 0.78rem;
        font-weight: 700;
        border-radius: 999px;
        border: 1px solid rgba(236, 254, 255, 0.36);
        background: rgba(236, 254, 255, 0.12);
        color: #ecfeff;
        padding: 0.24rem 0.62rem;
      }

      .wf-layout {
        margin-top: 1rem;
        display: grid;
        gap: 1rem;
      }

      .wf-panel {
        background: var(--wf-panel);
        border: 1px solid var(--wf-border);
        border-radius: 1rem;
        box-shadow: 0 7px 20px rgba(15, 23, 42, 0.08);
      }

      .wf-panel-section {
        padding: 1rem;
        border-bottom: 1px solid var(--wf-border);
      }

      .wf-panel-section:last-child {
        border-bottom: 0;
      }

      .wf-panel-title {
        font-size: 0.78rem;
        font-weight: 800;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: #334155;
        margin-bottom: 0.6rem;
      }

      .wf-role-chip {
        display: inline-flex;
        align-items: center;
        border-radius: 999px;
        border: 1px solid #c7d2fe;
        background: #eef2ff;
        color: #3730a3;
        padding: 0.22rem 0.66rem;
        font-size: 0.74rem;
        font-weight: 700;
      }

      .wf-roles {
        display: flex;
        flex-wrap: wrap;
        gap: 0.4rem;
      }

      .wf-toc {
        display: grid;
        gap: 0.33rem;
      }

      .wf-toc a {
        display: block;
        padding: 0.43rem 0.52rem;
        border-radius: 0.55rem;
        color: #334155;
        font-size: 0.82rem;
        line-height: 1.35;
        transition: background 120ms ease, color 120ms ease;
      }

      .wf-toc a:hover {
        background: #eef2ff;
        color: #3730a3;
      }

      .wf-toc a.is-active {
        background: #e0e7ff;
        color: #312e81;
        font-weight: 700;
      }

      .wf-content {
        padding: 1.2rem 1.15rem;
      }

      .help-workflow-body {
        display: grid;
        gap: 0.45rem;
      }

      .help-workflow-body h2 {
        font-size: 1.4rem;
        font-weight: 800;
        color: #1f2937;
        margin-top: 1.25rem;
        padding-top: 1.05rem;
        border-top: 1px solid #dbe7f0;
        scroll-margin-top: 6rem;
      }

      .help-workflow-body h2:first-of-type {
        margin-top: 0.15rem;
        padding-top: 0;
        border-top: 0;
      }

      .help-workflow-body h3 {
        font-size: 1.08rem;
        font-weight: 700;
        color: #1e293b;
        margin-top: 0.88rem;
        scroll-margin-top: 6rem;
      }

      .help-workflow-body p,
      .help-workflow-body li {
        color: var(--wf-muted);
        line-height: 1.67;
      }

      .help-workflow-body ol,
      .help-workflow-body ul {
        margin-left: 1.2rem;
      }

      .help-workflow-body code {
        background: #eef2ff;
        color: #3730a3;
        border: 1px solid #c7d2fe;
        padding: 0.1rem 0.35rem;
        border-radius: 0.3rem;
        font-size: 0.86em;
      }

      .wf-mobile-toc {
        margin-top: 0.95rem;
      }

      @media (min-width: 1024px) {
        .wf-layout {
          grid-template-columns: 270px minmax(0, 1fr);
          align-items: start;
        }

        .wf-sidebar {
          position: sticky;
          top: 1rem;
        }
      }

      @media (max-width: 1023px) {
        .wf-sidebar .wf-panel-section:nth-child(1) {
          display: none;
        }
      }
    </style>
</head>
<body class="flex flex-col min-h-screen">
    <div id="header-container"></div>
    <main class="flex-grow">
      <div class="wf-shell">
        <a href="help.html" class="wf-back-link">← Back to Help Center</a>
        <section class="wf-hero">
          <p class="wf-kicker">Workflow Guide</p>
          <h1 class="wf-title">${escapeHtml(title)}</h1>
          <p class="wf-summary">${escapeHtml(summary || 'Use this workflow to complete your task quickly and confidently.')}</p>
          <div class="wf-meta-row">
            <span class="wf-meta-pill">${escapeHtml(readTimeMin)} min read</span>
            <span class="wf-meta-pill">Updated from live product pages</span>
          </div>
        </section>

        <div class="wf-layout">
          <aside class="wf-sidebar wf-panel">
            <section class="wf-panel-section">
              <h2 class="wf-panel-title">On this page</h2>
              <nav id="workflow-toc" class="wf-toc"></nav>
            </section>
            <section class="wf-panel-section">
              <h2 class="wf-panel-title">Who can use this</h2>
              <div class="wf-roles">${buildRoleBadges(roles)}</div>
            </section>
          </aside>

          <article class="wf-panel wf-content">
            <div id="workflow-mobile-toc" class="wf-mobile-toc"></div>
            <div class="help-workflow-body">${bodyHtml}</div>
          </article>
        </div>
      </div>
    </main>
    <div id="footer-container"></div>
    ${standardChromeScript()}
    <script>
      (function() {
        const headings = Array.from(document.querySelectorAll('.help-workflow-body h2[id]'));
        const toc = document.getElementById('workflow-toc');
        const mobileToc = document.getElementById('workflow-mobile-toc');
        if (!toc || !headings.length) return;

        const links = headings.map((h) => {
          const a = document.createElement('a');
          a.href = '#' + h.id;
          a.textContent = h.textContent || h.id;
          toc.appendChild(a);
          return a;
        });

        if (mobileToc && window.innerWidth < 1024) {
          const wrapper = document.createElement('details');
          wrapper.className = 'wf-panel-section wf-panel';
          wrapper.style.marginBottom = '0.95rem';
          wrapper.style.padding = '0.8rem 1rem';
          const summary = document.createElement('summary');
          summary.textContent = 'Jump to section';
          summary.style.cursor = 'pointer';
          summary.style.fontWeight = '700';
          summary.style.color = '#0f172a';
          const list = toc.cloneNode(true);
          list.style.marginTop = '0.6rem';
          wrapper.appendChild(summary);
          wrapper.appendChild(list);
          mobileToc.appendChild(wrapper);
        }

        const sectionById = new Map(headings.map((h) => [h.id, h]));
        const setActive = () => {
          let active = headings[0];
          for (const h of headings) {
            if (h.getBoundingClientRect().top <= 140) active = h;
          }
          links.forEach((a) => a.classList.toggle('is-active', a.getAttribute('href') === '#' + active.id));
        };

        window.addEventListener('scroll', setActive, { passive: true });
        setActive();
      })();
    </script>
</body>
</html>`;
}

function renderIndex(manifest) {
    const cards = manifest.map((item) => `
        <article class="wf-card rounded-2xl border border-slate-200 bg-white p-5">
            <div class="wf-card-accent"></div>
            <h2 class="text-xl font-extrabold tracking-tight text-slate-900">${escapeHtml(item.title)}</h2>
            <p class="mt-2 text-sm text-slate-600 leading-6">${escapeHtml(item.summary)}</p>
            <div class="mt-4 flex flex-wrap gap-2">${buildRoleBadges(item.roles)}</div>
            <a class="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-primary-700 hover:text-primary-800" href="${escapeHtml(item.file)}">Open workflow <span aria-hidden="true">→</span></a>
        </article>
    `).join('\n');

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link rel="icon" type="image/png" href="img/logo_small.png">
    <title>Help Center - Workflows</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link rel="stylesheet" href="css/styles.css">
    ${primaryTailwindConfig()}
    <style>
      :root {
        --wf-bg: #f8fafc;
      }

      body {
        background:
          radial-gradient(circle at 82% -5%, rgba(99,102,241,0.16) 0%, rgba(248,250,252,0) 44%),
          radial-gradient(circle at -2% 22%, rgba(67,56,202,0.12) 0%, rgba(248,250,252,0) 48%),
          var(--wf-bg);
      }

      .wf-index-shell {
        width: min(1180px, 100%);
        margin: 0 auto;
        padding: 1.5rem 1rem 2.5rem;
      }

      .wf-index-hero {
        border-radius: 1.2rem;
        background: linear-gradient(140deg, #312e81 0%, #4338ca 52%, #4f46e5 100%);
        color: #ecfeff;
        padding: 1.35rem 1.3rem 1.2rem;
        box-shadow: 0 16px 38px rgba(15, 23, 42, 0.21);
      }

      .wf-index-hero h1 {
        font-size: clamp(1.9rem, 3.2vw, 2.7rem);
        line-height: 1.08;
        font-weight: 900;
        letter-spacing: -0.02em;
      }

      .wf-index-hero p {
        margin-top: 0.7rem;
        max-width: 70ch;
        line-height: 1.58;
        color: rgba(236, 254, 255, 0.92);
      }

      .wf-toolbar {
        margin-top: 1rem;
        border-radius: 1rem;
        background: rgba(255, 255, 255, 0.96);
        border: 1px solid #dbe7f0;
        box-shadow: 0 8px 20px rgba(15, 23, 42, 0.09);
        padding: 0.9rem;
      }

      .wf-toolbar-grid {
        display: grid;
        gap: 0.7rem;
      }

      .wf-toolbar input,
      .wf-toolbar select {
        width: 100%;
        border-radius: 0.75rem;
        border: 1px solid #cbd5e1;
        padding: 0.72rem 0.85rem;
        font-size: 0.9rem;
        color: #0f172a;
      }

      .wf-toolbar input:focus,
      .wf-toolbar select:focus {
        outline: 2px solid #c7d2fe;
        outline-offset: 1px;
        border-color: #6366f1;
      }

      .wf-card {
        position: relative;
        transition: transform 150ms ease, box-shadow 150ms ease, border-color 150ms ease;
        box-shadow: 0 8px 20px rgba(15, 23, 42, 0.08);
      }

      .wf-card:hover {
        transform: translateY(-2px);
        box-shadow: 0 14px 28px rgba(15, 23, 42, 0.13);
        border-color: #c7d2fe;
      }

      .wf-card-accent {
        width: 46px;
        height: 6px;
        border-radius: 999px;
        background: linear-gradient(90deg, #4f46e5 0%, #6366f1 100%);
        margin-bottom: 0.75rem;
      }

      @media (min-width: 860px) {
        .wf-toolbar-grid {
          grid-template-columns: 1fr 220px;
        }
      }
    </style>
</head>
<body class="text-gray-900 min-h-screen flex flex-col">
    <div id="header-container"></div>
    <main class="flex-grow">
      <div class="wf-index-shell">
        <section class="wf-index-hero">
            <h1>ALL PLAYS Help Center</h1>
            <p>Workflow-first guides built around real user outcomes. Find what you need, filter by role, and move from setup to game day faster.</p>
        </section>

        <section class="wf-toolbar">
          <div class="wf-toolbar-grid">
            <div>
              <input id="help-search" type="search" placeholder="Search workflows, tasks, or keywords" />
            </div>
            <div>
              <select id="help-role">
                <option value="">All roles</option>
                <option value="Parent">Parent</option>
                <option value="Coach">Coach</option>
                <option value="Admin">Admin</option>
                <option value="Member">Member</option>
              </select>
            </div>
          </div>
          <p id="help-summary" class="mt-3 text-sm text-slate-600"></p>
        </section>

        <section id="help-empty" class="mt-6 hidden rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">No workflows matched your current filters.</section>
        <section id="help-grid" class="mt-6 grid gap-4 md:grid-cols-2">${cards}</section>
      </div>
    </main>
    <div id="footer-container"></div>

    <script id="help-manifest" type="application/json">${JSON.stringify(manifest)}</script>
    ${standardChromeScript()}
    <script>
        const manifest = JSON.parse(document.getElementById('help-manifest').textContent || '[]');
        const searchInput = document.getElementById('help-search');
        const roleSelect = document.getElementById('help-role');
        const grid = document.getElementById('help-grid');
        const empty = document.getElementById('help-empty');
        const summary = document.getElementById('help-summary');

        function escapeHtml(v){return String(v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\"/g,'&quot;').replace(/'/g,'&#39;');}

        function render() {
            const q = (searchInput.value || '').toLowerCase().trim();
            const role = roleSelect.value;
            const filtered = manifest.filter((item) => {
                const text = (item.title + ' ' + item.summary + ' ' + (item.searchText || '')).toLowerCase();
                const roleOk = !role || (item.roles || []).includes(role) || (item.roles || []).includes('All');
                return (!q || text.includes(q)) && roleOk;
            }).sort((a,b)=>a.title.localeCompare(b.title));

            grid.innerHTML = filtered.map((item) => {
                const badges = (item.roles || ['All']).map((r) => '<span class="wf-role-chip">'+escapeHtml(r)+'</span>').join(' ');
                return '<article class="wf-card rounded-2xl border border-slate-200 bg-white p-5">'
                    + '<div class="wf-card-accent"></div>'
                    + '<h2 class="text-xl font-extrabold tracking-tight text-slate-900">'+escapeHtml(item.title)+'</h2>'
                    + '<p class="mt-2 text-sm text-slate-600 leading-6">'+escapeHtml(item.summary)+'</p>'
                    + '<div class="mt-4 flex flex-wrap gap-2">'+badges+'</div>'
                    + '<a class="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-primary-700 hover:text-primary-800" href="'+escapeHtml(item.file)+'">Open workflow <span aria-hidden="true">→</span></a>'
                    + '</article>';
            }).join('');

            if (!filtered.length) {
                empty.classList.remove('hidden');
                grid.classList.add('hidden');
            } else {
                empty.classList.add('hidden');
                grid.classList.remove('hidden');
            }
            summary.textContent = filtered.length + ' of ' + manifest.length + ' workflows';
        }

        searchInput.addEventListener('input', render);
        roleSelect.addEventListener('change', render);
        render();
    </script>
</body>
</html>`;
}

function main() {
    if (!fs.existsSync(WORKFLOW_MD_DIR)) {
        console.error('workflow-docs directory not found. Run build-help-workflow-doc-loop first.');
        process.exit(1);
    }
    const files = fs.readdirSync(WORKFLOW_MD_DIR).filter((f) => f.endsWith('.md')).sort();
    const manifest = [];

    files.forEach((file) => {
        const md = fs.readFileSync(path.join(WORKFLOW_MD_DIR, file), 'utf8');
        const id = file.replace(/\.md$/, '');
        const title = extractTitle(md, id);
        const bodyHtml = mdToHtml(md);
        const roles = extractRoles(md);
        const summary = summarize(md);
        const readTimeMin = estimateReadTime(md);

        const htmlFile = `workflow-${id}.html`;
        fs.writeFileSync(path.join(ROOT, htmlFile), renderArticle({ title, roles, bodyHtml, summary, readTimeMin }));
        manifest.push({ id, title, roles, file: htmlFile, summary, readTimeMin, searchText: md.slice(0, 2000) });
        console.log(`wrote ${htmlFile}`);
    });

    fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2));
    fs.writeFileSync(HELP_HTML, renderIndex(manifest));
    console.log(`Updated help.html and ${MANIFEST}`);
}

main();
