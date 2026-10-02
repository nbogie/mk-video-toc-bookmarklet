// Build: concatenate src/toc.js + src/bookmarklet.js into one IIFE, then emit
//   dist/bookmarklet.js      readable single file (paste into DevTools console)
//   dist/bookmarklet.txt     javascript: URL to paste into a bookmark — built from the
//                            UNMINIFIED source, so what members run is exactly what is in
//                            src/ with no third-party code (terser) in the build chain.
//                            This is the default release artifact.
//   dist/bookmarklet.min.js  terser-minified source (no runtime dependency on terser)
//   dist/bookmarklet.min.txt the same as a javascript: URL — optional smaller artifact;
//                            only ship it if the build machine and lockfile are trusted
//   dist/bookmarklet.shipped.js  exactly the JavaScript inside dist/bookmarklet.txt (decoded), for
//                            reviewers to diff against what they installed
//   dist/install.html        install page: drag the link to the bookmarks bar, or copy the
//                            text. Host it UNLISTED (it contains the gist id). Static: a
//                            new release means re-publishing this page.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { minify } = require('terser');

const { requireEnv, buildId } = require('./env.js');

// Build-time configuration (see .env.example). Validated so a typo can't ship.
function loadConfig() {
  const e = requireEnv(['TOC_GIST_USER', 'TOC_GIST_ID', 'TOC_ALLOWED_HOSTS']);
  const cfg = { user: e.TOC_GIST_USER, id: e.TOC_GIST_ID, hosts: e.TOC_ALLOWED_HOSTS.split(',').map(h => h.trim()).filter(Boolean) };
  if (!/^[A-Za-z0-9-]+$/.test(cfg.user) || !/^[0-9a-f]{20,40}$/.test(cfg.id) ||
      !cfg.hosts.length || !cfg.hosts.every(h => /^[a-z0-9.-]+$/i.test(h))) {
    console.error('TOC_GIST_USER must be a GitHub username, TOC_GIST_ID a hex gist id, TOC_ALLOWED_HOSTS a comma-separated list of hostnames.');
    process.exit(1);
  }
  return cfg;
}

const SRC = path.join(__dirname, 'src');
const DIST = path.join(__dirname, 'dist');

async function main() {
  const toc = fs.readFileSync(path.join(SRC, 'toc.js'), 'utf8');
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
  const cfg = loadConfig();
  const version = buildId(pkg.version);
  const main = fs.readFileSync(path.join(SRC, 'bookmarklet.js'), 'utf8')
    .replace('__VERSION__', version)
    .replace('__GIST_USER__', cfg.user)
    .replace('__GIST_ID__', cfg.id)
    .replace('__ALLOWED_HOSTS__', cfg.hosts.join(','));
  const leftover = main.match(/__[A-Z_]+__/);
  if (leftover) { console.error('Unreplaced placeholder in source: ' + leftover[0]); process.exit(1); }
  // toc.js defines plain functions; bookmarklet.js is its own IIFE that uses them.
  const combined = '(function() {\n' + toc + '\n' + main + '})();\n';

  fs.mkdirSync(DIST, { recursive: true });
  fs.writeFileSync(path.join(DIST, 'bookmarklet.js'), combined);

  const result = await minify(combined, { compress: true, mangle: true, format: { ascii_only: true } });
  if (result.error) throw result.error;
  const min = result.code;
  fs.writeFileSync(path.join(DIST, 'bookmarklet.min.js'), min);

  // Bookmarks silently break on raw '#', '%', spaces and newlines, so percent-encode.
  // encodeURI leaves '#' alone (it's a valid fragment delimiter), so handle it explicitly.
  // Line comments would swallow the rest of the (single-line) URL, so strip them first;
  // block comments and everything else survive percent-encoding intact.
  const shippable = combined
    .replace(/^\s*\/\/.*$/mg, '')
    .replace(/([^:'"\\])\/\/(?![^'"]*['"]\s*[,;)]).*$/mg, '$1')
    .replace(/\n{3,}/g, '\n\n');
  new Function(shippable); // syntax check: the stripped source must still parse
  const url = 'javascript:' + encodeURI(shippable).replace(/#/g, '%23');
  fs.writeFileSync(path.join(DIST, 'bookmarklet.txt'), url + '\n');
  fs.writeFileSync(path.join(DIST, 'bookmarklet.shipped.js'), shippable);
  // Hash of the URL string itself (no trailing newline) — what a bookmark holds.
  const sha256 = crypto.createHash('sha256').update(url).digest('hex');
  fs.writeFileSync(path.join(DIST, 'bookmarklet.sha256'), sha256 + '\n');
  const minUrl = 'javascript:' + encodeURI(min).replace(/#/g, '%23');
  fs.writeFileSync(path.join(DIST, 'bookmarklet.min.txt'), minUrl + '\n');

  fs.writeFileSync(path.join(DIST, 'install.html'), installPage(url, version, cfg.hosts, sha256, pkg.repository));
  fs.writeFileSync(path.join(DIST, 'version.txt'), version + '\n');

  console.log('dist/bookmarklet.js      ' + combined.length + ' bytes');
  console.log('dist/bookmarklet.min.js  ' + min.length + ' bytes');
  console.log('build id                 ' + version + (version.endsWith('-dirty') ? '  (uncommitted changes: not deployable)' : ''));
  console.log('dist/bookmarklet.txt     ' + url.length + ' bytes  (default: unminified)');
  console.log('dist/bookmarklet.min.txt ' + minUrl.length + ' bytes  (optional: minified)');
}

function escapeAttr(s) {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function installPage(url, version, hosts, sha256, repo) {
  const href = escapeAttr(url);
  const hostList = hosts.map(escapeAttr).join(' and ');
  const repoUrl = (repo && repo.url) ? escapeAttr(repo.url.replace(/^git\+/, '').replace(/\.git$/, '')) : '';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta name="color-scheme" content="dark">
<title>MK Practice Video ToC Bookmarklet</title>
<style>
  :root { --ebony:#1B1815; --raised:#2A2521; --ivory:#EDE4CF; --mid:#CFC5B0; --dim:#AFA592; --baize:#5C8A6A; --brass:#C9A453; --rule:rgba(237,228,207,.14); }
  html { background:var(--ebony); }
  body { margin:0; padding:36px 16px 56px; color:var(--mid); font:16px/1.55 ui-sans-serif,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif; }
  main { max-width:600px; margin:0 auto; }
  h1 { color:var(--ivory); font-size:26px; line-height:1.2; font-weight:600; margin:0 0 6px; }
  .lede { margin:0 0 30px; }
  .lede small { display:block; color:var(--dim); font-size:13px; margin-top:4px; }
  h2 { color:var(--ivory); font-size:18px; font-weight:600; margin:34px 0 10px; }
  p { margin:0 0 10px; }
  ol { padding-left:22px; margin:0 0 10px; }
  li { margin:0 0 6px; }
  b { color:var(--ivory); font-weight:600; }
  a { color:var(--ivory); text-underline-offset:2px; }
  kbd { font:inherit; font-size:14px; color:var(--ivory); background:var(--raised); border-radius:4px; padding:1px 6px; white-space:nowrap; }
  code { font:13px/1.5 ui-monospace,Menlo,Consolas,monospace; color:var(--ivory); background:var(--raised); border-radius:4px; padding:1px 5px; word-break:break-all; }
  .drag { display:block; margin:14px 0 8px; padding:22px 20px; background:var(--raised); color:var(--ivory); text-decoration:none; text-align:center;
          border:2px dashed var(--baize); border-radius:10px; font-size:20px; font-weight:600; cursor:grab; }
  .drag:active { cursor:grabbing; }
  .drag:focus-visible, button:focus-visible, summary:focus-visible { outline:2px solid var(--baize); outline-offset:3px; }
  .hint { color:var(--dim); font-size:14px; margin:0 0 6px; }
  .bar { color:var(--dim); font-size:14px; margin:0 0 6px; }
  .bar-list { list-style:none; margin:0 0 10px; padding:0; color:var(--dim); font-size:14px; }
  .bar-list li { margin:0 0 4px; display:grid; grid-template-columns:9.5em 1fr; column-gap:10px; }
  .bar-list b { color:var(--mid); font-weight:600; }
  @media (max-width: 420px) { .bar-list li { grid-template-columns:1fr; } }
  details { border-top:1px solid var(--rule); }
  details:last-of-type { border-bottom:1px solid var(--rule); }
  summary { cursor:pointer; padding:12px 0; color:var(--ivory); font-weight:600; list-style:none; display:flex; align-items:center; gap:10px; }
  summary::-webkit-details-marker { display:none; }
  summary::before { content:""; width:7px; height:7px; border-right:2px solid var(--dim); border-bottom:2px solid var(--dim); transform:rotate(-45deg); transition:transform .15s; flex:0 0 auto; }
  details[open] > summary::before { transform:rotate(45deg); }
  .body { padding:0 0 16px; font-size:15px; }
  .body p, .body ol { font-size:15px; }
  .copybox { display:flex; flex-wrap:wrap; gap:8px; margin:8px 0 12px; }
  textarea { flex:1 1 220px; height:64px; background:var(--ebony); color:var(--dim); border:1px solid var(--rule); border-radius:6px; padding:8px; font:12px/1.4 ui-monospace,Menlo,Consolas,monospace; resize:vertical; }
  button { font:inherit; font-size:15px; background:var(--raised); color:var(--ivory); border:0; border-radius:6px; padding:8px 14px; cursor:pointer; align-self:flex-start; }
  button:hover { background:#35302A; }
  .mobile { display:none; margin:0 0 14px; padding:10px 12px; border-left:3px solid var(--brass); color:var(--mid); font-size:15px; }
  .foot { margin-top:34px; color:var(--dim); font-size:14px; }
  @media (pointer: coarse), (max-width: 540px) { .mobile { display:block; } }
  @media (prefers-reduced-motion: reduce) { summary::before { transition:none; } }
</style>
</head>
<body>
<main>
  <h1>MK Practice Video ToC Bookmarklet</h1>
  <p class="lede">A clickable table of contents, keyboard shortcuts and optional MIDI control for the practice session videos.
    <small>Version ${version}</small></p>

  <h2>Install</h2>
  <p class="mobile">On a phone or tablet there is no bookmarks bar to drag to. Use "Copy the text instead" below, then paste it as a new bookmark's address.</p>
  <p class="bar">Show your bookmarks bar first:</p>
  <ul class="bar-list">
    <li><b>Chrome, Mac</b> View → Always Show Bookmarks Bar</li>
    <li><b>Chrome, Windows</b> ⋮ menu → Bookmarks and lists → Show bookmarks bar</li>
    <li><b>Safari</b> View → Show Favorites Bar</li>
  </ul>
  <a class="drag" href="${href}" onclick="return false" title="Drag me to the bookmarks bar">MK Video ToC bookmarklet</a>
  <p class="hint">Drag the box onto your bookmarks bar. Clicking it here does nothing.</p>

  <details id="copy-details">
    <summary>Copy the text instead</summary>
    <div class="body">
      <p>Safari, and some touchpads, won't drag. Copy the text, bookmark any page, then edit that bookmark and paste the text in place of its address.</p>
      <div class="copybox">
        <textarea id="code" readonly spellcheck="false" aria-label="Bookmarklet text">${escapeAttr(url)}</textarea>
        <button id="copy" type="button">Copy</button>
      </div>
      <p>Where to paste: Chrome, right-click the bookmark → Edit → URL. Firefox, right-click → Edit Bookmark → Location. Safari, Bookmarks → Edit Bookmarks, right-click → Edit Address.</p>
    </div>
  </details>

  <h2>Use</h2>
  <ol>
    <li>Open a practice session post and press <b>play</b> on the video.</li>
    <li>Click the <b>MK Video ToC bookmarklet</b> bookmark. The contents panel appears on the right.</li>
    <li>Click any entry to jump there. <kbd>Alt</kbd>+<kbd>→</kbd> and <kbd>Alt</kbd>+<kbd>←</kbd> (Option on a Mac) step between timestamps.</li>
    <li>Drag the panel's title bar to move it, or its left or bottom edge to resize it. The <b>–</b> button minimises it.</li>
  </ol>
  <p class="hint">MIDI control is under the panel's settings cog. It works in Chrome and Firefox; Safari has no MIDI support.</p>

  <details>
    <summary>Updating</summary>
    <div class="body">
      <p>Come back here, drag the box again, and delete the old bookmark. Hover over "Contents" in the panel to see which version you have.</p>
    </div>
  </details>
  <details>
    <summary>Checking what you installed</summary>
    <div class="body">
      <p>The source code is public${repoUrl ? ' at <a href="' + repoUrl + '">' + repoUrl.replace(/^https?:\/\//, '') + '</a>' : ''}, and the bookmark is that code with the location of the tables of contents and the course site's name filled in, nothing else.</p>
      <p>${repoUrl ? '<a href="' + repoUrl + '/blob/main/docs/VERIFYING.md">How to confirm that for yourself</a>' : 'The repository'} is described there in words, with no commands to copy. A check is only worth something when the reference comes from somewhere other than this page.</p>
    </div>
  </details>

  <p class="foot">The bookmarklet only does anything on ${hostList}. It reads the tables of contents from a private list and sends nothing anywhere.</p>
</main>
<script>
  (function () {
    var coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    if (coarse) document.getElementById('copy-details').open = true;
    document.getElementById('copy').addEventListener('click', function () {
      var btn = this, ta = document.getElementById('code');
      var done = function () { btn.textContent = 'Copied'; setTimeout(function () { btn.textContent = 'Copy'; }, 1500); };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(ta.value).then(done, function () { ta.select(); });
      else { ta.select(); try { document.execCommand('copy'); done(); } catch (e) {} }
    });
  })();
</script>
</body>
</html>
`;
}

main().catch(err => { console.error(err); process.exit(1); });
