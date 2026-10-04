// Exercise the browser enhancement without adding a DOM library dependency.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const code = readFileSync(new URL('../site/assets/navigation.js', import.meta.url), 'utf8')
  .replace('import.meta.url', JSON.stringify('https://example.test/lab/assets/navigation.js'));

function harness(fetch) {
  const rows = [
    { dataset: { search: 'dns /dns.html private names', pagePath: '/dns.html' }, href: 'https://example.test/lab/dns/' },
    { dataset: { search: 'old bookmark /old.html', pagePath: '/old.html' }, href: 'https://example.test/lab/old/' },
  ].map(row => Object.assign(row, {
    children: [], hidden: false,
    address: {},
    querySelector: selector => selector === 'a' ? { href: row.href } : selector === 'small' ? row.address : row.children[0],
    append: child => row.children.push(child),
  }));
  const groups = rows.map((row, index) => ({ tagName: index ? 'DETAILS' : 'SECTION', open: false, hidden: false, querySelectorAll: () => [row] }));
  const search = { value: '', addEventListener: (_event, handler) => { search.input = handler; } };
  const elements = { 'page-search': search, 'page-count': {}, 'no-pages': {}, jumps: {} };
  runInNewContext(code, { URL, fetch, document: {
    getElementById: id => elements[id],
    querySelectorAll: selector => selector === '[data-page]' ? rows : groups,
    querySelector: () => elements.jumps, createElement: () => ({}),
  } });
  return { rows, groups, elements, search, query: value => { search.value = value; search.input(); } };
}

const settle = () => new Promise(resolve => setImmediate(resolve));

test('body-only terms, escaped excerpts, base prefix, clearing and empty results', async () => {
  let requests = 0;
  const h = harness(async url => {
    requests++;
    assert.equal(url.href, 'https://example.test/lab/assets/unify/search-corpus.json');
    return { ok: true, json: async () => ({ schemaVersion: 1, pages: [
      { path: '/lab/dns/', text: 'An unusual rambutan <script>plain text, not executable</script>' },
    ] }) };
  });
  assert.equal(requests, 0); // No corpus download until someone searches.
  assert.equal(h.rows[0].dataset.pagePath, '/lab/dns/');
  assert.equal(h.rows[0].address.textContent, '/lab/dns/');
  h.query('rambutan');
  await settle();
  assert.equal(h.rows[0].hidden, false);
  assert.equal(h.rows[1].hidden, true);
  assert.match(h.rows[0].children[0].textContent, /<script>/);
  assert.equal(h.rows[0].children[0].innerHTML, undefined);
  assert.equal(h.elements['page-count'].textContent, '1 of 2 pages');
  h.query('no-such-page');
  assert.equal(h.elements['no-pages'].hidden, false);
  h.query('old bookmark'); // Bookmark remains searchable without a corpus entry.
  assert.equal(h.rows[1].hidden, false);
  assert.equal(h.groups[1].open, true);
  h.query('');
  assert.ok(h.rows.every(row => !row.hidden));
  assert.ok(h.groups.every(group => !group.hidden));
  assert.equal(h.groups[1].open, false);
  assert.equal(h.elements.jumps.hidden, false);
  assert.equal(h.rows[0].children[0].hidden, true);
  assert.equal(requests, 1);
});

test('a query changed while loading uses the current query', async () => {
  let deliver;
  const h = harness(() => new Promise(resolve => { deliver = resolve; }));
  h.query('rambutan');
  assert.match(h.elements['page-count'].textContent, /Searching page content/);
  h.query('old bookmark');
  deliver({ ok: true, json: async () => ({ schemaVersion: 1, pages: [{ path: '/lab/dns/', text: 'rambutan' }] }) });
  await settle();
  assert.equal(h.rows[0].hidden, true);
  assert.equal(h.rows[1].hidden, false);
});

for (const [name, response] of [
  ['network error', () => { throw new Error('offline'); }],
  ['HTTP error', () => ({ ok: false })],
  ['unsupported schema', () => ({ ok: true, json: async () => ({ schemaVersion: 99, pages: [] }) })],
  ['malformed page', () => ({ ok: true, json: async () => ({ schemaVersion: 1, pages: [{ path: 42, text: null }] }) })],
]) {
  test(`${name} preserves metadata filtering`, async () => {
    const h = harness(async () => response());
    h.query('dns');
    await settle();
    assert.equal(h.rows[0].hidden, false);
    assert.equal(h.rows[1].hidden, true);
    assert.match(h.elements['page-count'].textContent, /Page content unavailable/);
  });
}
