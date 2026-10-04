// Progressive enhancement: all links are already present without JavaScript.
const search = document.getElementById('page-search');
const rows = [...document.querySelectorAll('[data-page]')];
const groups = [...document.querySelectorAll('[data-page-group]')];
// Unify rewrites hrefs, not data attributes. Use the actual built link as the
// corpus join key, including pretty URLs, encoded filenames and subpath hosting.
for (const row of rows) {
  const path = new URL(row.querySelector('a').href).pathname;
  row.dataset.pagePath = path;
  row.dataset.search += ` ${path.toLowerCase()}`;
  row.querySelector('small').textContent = path;
}
let content = new Map();
let contentState = 'idle';

function filter() {
  const terms = search.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
  for (const row of rows) {
    const body = content.get(row.dataset.pagePath);
    const metadataMatch = terms.every(term => row.dataset.search.includes(term));
    row.hidden = !metadataMatch && !terms.every(term => `${row.dataset.search} ${body?.folded ?? ''}`.includes(term));
    let excerpt = row.querySelector('.search-excerpt');
    if (excerpt) excerpt.hidden = true;
    if (!row.hidden && !metadataMatch && body) {
      if (!excerpt) {
        excerpt = document.createElement('p');
        excerpt.className = 'search-excerpt dim';
        row.append(excerpt);
      }
      const at = Math.max(0, body.folded.indexOf(terms.find(term => !row.dataset.search.includes(term))));
      const start = Math.max(0, at - 60);
      excerpt.textContent = `${start ? '…' : ''}${body.text.slice(start, start + 220)}${body.text.length > start + 220 ? '…' : ''}`;
      excerpt.hidden = false;
    }
  }
  for (const group of groups) {
    group.hidden = ![...group.querySelectorAll('[data-page]')].some(row => !row.hidden);
    // Search must also reveal matches in the normally collapsed older pages.
    if (group.tagName === 'DETAILS') group.open = terms.length > 0 && !group.hidden;
  }
  const found = rows.filter(row => !row.hidden).length;
  const status = contentState === 'loading' ? ' · Searching page content…' :
    contentState === 'failed' ? ' · Page content unavailable; searching titles, addresses and descriptions.' : '';
  document.getElementById('page-count').textContent = terms.length ? `${found} of ${rows.length} pages${status}` : `${rows.length} pages`;
  document.getElementById('no-pages').hidden = found !== 0 || contentState === 'loading';
  document.querySelector('.sitemap-jumps').hidden = terms.length > 0;
}

async function loadContent() {
  contentState = 'loading';
  filter();
  try {
    const response = await fetch(new URL('./unify/search-corpus.json', import.meta.url));
    if (!response.ok) throw new Error('Search corpus unavailable');
    const corpus = await response.json();
    if (corpus.schemaVersion !== 1 || !Array.isArray(corpus.pages)) throw new Error('Unsupported search corpus');
    content = new Map(corpus.pages.map(page => {
      if (typeof page.path !== 'string' || typeof page.text !== 'string') throw new Error('Invalid search page');
      return [page.path, { text: page.text, folded: page.text.toLowerCase() }];
    }));
    contentState = 'ready';
  } catch {
    contentState = 'failed';
  }
  filter(); // Use the current query, not the one that started the request.
}

search.addEventListener('input', () => {
  if (search.value.trim() && contentState === 'idle') void loadContent();
  else filter();
});
