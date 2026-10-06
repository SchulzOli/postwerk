import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { checkExternal, checkSite, parseHtml, resolveInternal } from './check-links.mjs';

let server;
let origin;

before(async () => {
  server = createServer((req, res) => {
    const status = { '/ok': 200, '/gone': 404, '/blocked': 403, '/no-head': req.method === 'HEAD' ? 405 : 200 }[req.url] ?? 404;
    res.writeHead(status).end('<html></html>');
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  origin = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

test('reads links and anchors from HTML', () => {
  const { links, ids } = parseHtml('<h2 id="set-it-up">Set it up</h2><a class="x" href="/postwerk/guide?a=1&amp;b=2#top">x</a><img alt="" src="./a.png">');
  assert.deepEqual(links, ['/postwerk/guide?a=1&b=2#top', './a.png']);
  assert.ok(ids.has('set-it-up'));
});

test('resolves clean URLs below the base path', () => {
  const dist = mkdtempSync(join(tmpdir(), 'links-'));
  mkdirSync(join(dist, 'networks'));
  for (const file of ['index.html', 'guide.html', 'networks/index.html', 'networks/meta.html']) writeFileSync(join(dist, file), '');
  const page = join(dist, 'networks', 'meta.html');
  const file = (href) => resolveInternal(dist, '/postwerk/', page, href).file?.slice(dist.length + 1) ?? null;
  assert.equal(file('/postwerk/'), 'index.html');
  assert.equal(file('/postwerk/guide'), 'guide.html');
  assert.equal(file('/postwerk/networks/'), 'networks/index.html');
  assert.equal(file('#instagram'), 'networks/meta.html');
  assert.equal(file('../guide'), 'guide.html');
  assert.equal(file('/postwerk/nope'), null);
  assert.equal(file('/elsewhere/'), null);
});

test('tells missing addresses from ones that refuse to answer', async () => {
  assert.equal((await checkExternal(`${origin}/ok`)).state, 'ok');
  assert.equal((await checkExternal(`${origin}/no-head`)).state, 'ok');
  assert.deepEqual(await checkExternal(`${origin}/gone`), { state: 'missing', reason: 'HTTP 404' });
  assert.deepEqual(await checkExternal(`${origin}/blocked`), { state: 'blocked', reason: 'HTTP 403' });
  assert.equal((await checkExternal('http://does-not-exist.invalid/')).state, 'missing');
});

test('reports links without a target with their Markdown source, and never throws', async () => {
  const root = mkdtempSync(join(tmpdir(), 'site-'));
  const dist = join(root, 'dist');
  mkdirSync(dist);
  writeFileSync(join(root, 'index.md'), '# Home\n\nSee [the guide](guide.md#setup) and [gone](' + origin + '/gone).\n');
  writeFileSync(join(root, 'guide.md'), '# Guide\n\n## Set it up\n');
  writeFileSync(join(dist, 'index.html'), `<a href="/postwerk/guide#setup">guide</a><a href="${origin}/gone">gone</a><a href="${origin}/ok">ok</a><a href="mailto:a@b.c">mail</a>`);
  writeFileSync(join(dist, 'guide.html'), '<h2 id="set-it-up">Set it up</h2><a href="/postwerk/missing">x</a>');
  const result = await checkSite(dist, { base: '/postwerk/', repoRoot: root, sourceDir: root });
  assert.equal(result.pages, 2);
  assert.equal(result.external, 2);
  const byHref = Object.fromEntries(result.problems.map((problem) => [problem.href, problem]));
  assert.equal(byHref['/postwerk/guide#setup'].reason, 'no anchor #setup');
  assert.deepEqual(byHref['/postwerk/guide#setup'].source, { file: 'index.md', line: 3 });
  assert.equal(byHref['/postwerk/missing'].reason, 'no such page or file');
  assert.deepEqual(byHref[`${origin}/gone`].source, { file: 'index.md', line: 3 });
  assert.equal(result.problems.length, 3);
});
