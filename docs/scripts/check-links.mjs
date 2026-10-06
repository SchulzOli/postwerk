#!/usr/bin/env node
/**
 * Checks every link of the built documentation website and never fails the
 * build because of one:
 *
 * - internal links: the page or file exists, and so does the #anchor;
 * - external links: the address answers (HEAD, then GET).
 *
 * Links without a target become GitHub warnings (file and line of the
 * Markdown source); links a site refused to answer (403, 429, timeouts) become
 * notices. A report goes to the job summary ($GITHUB_STEP_SUMMARY) and to
 * .vitepress/link-report.md.
 *
 * Usage: node scripts/check-links.mjs .vitepress/dist
 * Env: SITE_BASE (default /postwerk/), CHECK_EXTERNAL=false to skip external links.
 */
import { appendFileSync, existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const BROWSER = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36 postwerk-link-check';

const decode = (value) => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

const unescapeHtml = (value) => value.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');

/** Links (a href, img src) and anchor ids of one HTML page. */
export function parseHtml(html) {
  const links = [];
  for (const match of html.matchAll(/<(a|img)\b[^>]*?\s(href|src)="([^"]*)"/gi)) links.push(unescapeHtml(match[3]));
  const ids = new Set();
  for (const match of html.matchAll(/\s(?:id|name)="([^"]+)"/gi)) ids.add(decode(unescapeHtml(match[1])));
  return { links, ids };
}

/** Files below a folder with an extension, skipping node_modules and hidden folders. */
function filesWith(dir, extension) {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...filesWith(path, extension));
    else if (entry.name.endsWith(extension)) found.push(path);
  }
  return found;
}

/**
 * The built file an internal link points to, or null. Understands the site's
 * base path and clean URLs (/guide → guide.html, /networks/ → networks/index.html).
 */
export function resolveInternal(dist, base, page, href) {
  const url = new URL(href, `https://site.invalid${base}${relative(dist, page).replace(/\\/g, '/')}`);
  let path = decode(url.pathname);
  if (!path.startsWith(base)) return { file: null, hash: url.hash };
  path = path.slice(base.length);
  const candidates = path === '' || path.endsWith('/') ? [`${path}index.html`] : [path, `${path}.html`, `${path}/index.html`];
  const file = candidates.map((candidate) => join(dist, candidate)).find((candidate) => existsSync(candidate) && statSync(candidate).isFile());
  return { file: file ?? null, hash: url.hash };
}

/** Whether an external address answers: ok, missing (no target) or blocked (could not verify). */
export async function checkExternal(url, { timeoutMs = 15_000 } = {}) {
  const attempt = async (method) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { method, redirect: 'follow', signal: controller.signal, headers: { 'user-agent': BROWSER, accept: 'text/html,*/*' } });
      await response.body?.cancel();
      return { status: response.status };
    } catch (error) {
      return { error: error?.cause?.code ?? (error?.name === 'AbortError' ? 'timeout' : (error?.message ?? 'error')) };
    } finally {
      clearTimeout(timer);
    }
  };
  let result = await attempt('HEAD');
  if (result.error || result.status >= 400) result = await attempt('GET');
  if (result.status && result.status < 400) return { state: 'ok', reason: String(result.status) };
  if (result.status === 404 || result.status === 410) return { state: 'missing', reason: `HTTP ${result.status}` };
  if (['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ERR_INVALID_URL'].includes(result.error)) return { state: 'missing', reason: result.error };
  return { state: 'blocked', reason: result.status ? `HTTP ${result.status}` : result.error };
}

async function mapLimit(items, limit, run) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const index = next++;
        results[index] = await run(items[index]);
      }
    }),
  );
  return results;
}

/** The Markdown file and line a link most likely comes from (for the annotation). */
function locate(sources, page, href, dist) {
  const pageSource = relative(dist, page).replace(/\.html$/, '.md');
  const ordered = [...sources.filter((source) => source.path === pageSource), ...sources.filter((source) => source.path !== pageSource)];
  const url = href.startsWith('http') ? href : null;
  const needles = url ? [url, url.replace(/\/$/, '')] : (() => {
    const [path, hash] = href.split('#');
    const last = path.replace(/\/$/, '').split('/').pop() || 'index';
    return [hash ? `${last}.md#${hash}` : null, hash ? `${last}#${hash}` : null, hash ? `#${hash}` : null, `${last}.md`, last].filter(Boolean);
  })();
  for (const needle of needles) {
    for (const source of ordered) {
      const index = source.lines.findIndex((line) => line.includes(needle));
      if (index >= 0) return { file: source.file, line: index + 1 };
    }
  }
  return { file: ordered[0]?.file };
}

const escapeData = (value) => String(value).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
const escapeProperty = (value) => escapeData(value).replace(/:/g, '%3A').replace(/,/g, '%2C');

/** Checks the site in `dist`; returns the problems found. */
export async function checkSite(dist, { base = '/postwerk/', external = true, repoRoot, sourceDir } = {}) {
  dist = resolve(dist);
  const pages = filesWith(dist, '.html');
  const parsed = new Map(pages.map((page) => [page, parseHtml(readFileSync(page, 'utf8'))]));
  const sources = sourceDir
    ? filesWith(sourceDir, '.md').map((file) => ({ path: relative(sourceDir, file).replace(/\\/g, '/'), file, lines: readFileSync(file, 'utf8').split('\n') }))
    : [];

  const problems = [];
  const externalUses = new Map();
  let internalCount = 0;
  for (const [page, { links }] of parsed) {
    for (const href of new Set(links)) {
      if (!href || /^(mailto|tel|javascript|data):/i.test(href)) continue;
      if (/^https?:\/\//i.test(href)) {
        if (!externalUses.has(href)) externalUses.set(href, []);
        externalUses.get(href).push(page);
        continue;
      }
      internalCount++;
      const { file, hash } = resolveInternal(dist, base, page, href);
      if (!file) problems.push({ kind: 'missing', href, reason: 'no such page or file', pages: [page] });
      else if (hash && hash.length > 1 && file.endsWith('.html') && !parsed.get(file)?.ids.has(decode(hash.slice(1)))) {
        problems.push({ kind: 'missing', href, reason: `no anchor ${decode(hash)}`, pages: [page] });
      }
    }
  }

  const externalLinks = [...externalUses.keys()];
  if (external) {
    const results = await mapLimit(externalLinks, 8, (url) => checkExternal(url));
    externalLinks.forEach((url, index) => {
      const result = results[index];
      if (result.state !== 'ok') problems.push({ kind: result.state, href: url, reason: result.reason, pages: externalUses.get(url) });
    });
  }

  // One entry per broken link, with the pages it appears on.
  const merged = new Map();
  for (const problem of problems) {
    const key = `${problem.kind} ${problem.href} ${problem.reason}`;
    if (merged.has(key)) merged.get(key).pages.push(...problem.pages);
    else merged.set(key, { ...problem, pages: [...problem.pages] });
  }
  const list = [...merged.values()].map((problem) => ({
    ...problem,
    pages: [...new Set(problem.pages.map((page) => relative(dist, page)))],
    source: locate(sources, problem.pages[0], problem.href, dist),
  }));
  for (const problem of list) if (problem.source.file && repoRoot) problem.source.file = relative(repoRoot, problem.source.file);
  return { pages: pages.length, internal: internalCount, external: external ? externalLinks.length : 0, problems: list };
}

function report({ pages, internal, external, problems }, externalChecked) {
  const missing = problems.filter((problem) => problem.kind === 'missing');
  const blocked = problems.filter((problem) => problem.kind === 'blocked');
  const lines = ['## Link check', ''];
  lines.push(`${pages} pages · ${internal} internal links · ${externalChecked ? `${external} external addresses` : 'external links not checked'}`, '');
  if (problems.length === 0) lines.push('✅ Every link has a target.');
  else {
    if (missing.length) lines.push(`⚠️ **${missing.length} link${missing.length === 1 ? '' : 's'} without a target**`);
    if (blocked.length) lines.push(`ℹ️ ${blocked.length} address${blocked.length === 1 ? '' : 'es'} could not be verified (the site refused or timed out)`);
    lines.push('', '| | Link | Problem | Source | Pages |', '|---|---|---|---|---|');
    for (const problem of [...missing, ...blocked]) {
      const source = problem.source.file ? `${problem.source.file}${problem.source.line ? `:${problem.source.line}` : ''}` : '';
      lines.push(`| ${problem.kind === 'missing' ? '⚠️' : 'ℹ️'} | ${problem.href.replace(/\|/g, '\\|')} | ${problem.reason} | ${source} | ${problem.pages.slice(0, 3).join(', ')}${problem.pages.length > 3 ? ` +${problem.pages.length - 3}` : ''} |`);
    }
  }
  return `${lines.join('\n')}\n`;
}

async function main() {
  const dist = process.argv[2] ?? '.vitepress/dist';
  const docsDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const repoRoot = resolve(docsDir, '..');
  const external = process.env.CHECK_EXTERNAL !== 'false';
  const result = await checkSite(dist, { base: process.env.SITE_BASE ?? '/postwerk/', external, repoRoot, sourceDir: docsDir });

  for (const problem of result.problems) {
    const level = problem.kind === 'missing' ? 'warning' : 'notice';
    const props = [problem.source.file && `file=${escapeProperty(problem.source.file)}`, problem.source.line && `line=${problem.source.line}`, `title=${escapeProperty(problem.kind === 'missing' ? 'Link without target' : 'Link not verified')}`]
      .filter(Boolean)
      .join(',');
    console.log(`::${level} ${props}::${escapeData(`${problem.href} (${problem.reason}) on ${problem.pages.join(', ')}`)}`);
  }
  const markdown = report(result, external);
  console.log(markdown);
  writeFileSync(join(docsDir, '.vitepress', 'link-report.md'), markdown);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
