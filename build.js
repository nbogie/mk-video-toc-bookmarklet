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

const { requireEnv } = require('./env.js');

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
  const main = fs.readFileSync(path.join(SRC, 'bookmarklet.js'), 'utf8')
    .replace('__VERSION__', pkg.version)
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

  fs.writeFileSync(path.join(DIST, 'install.html'), installPage(url, pkg.version, cfg.hosts, sha256, pkg.repository));

  console.log('dist/bookmarklet.js      ' + combined.length + ' bytes');
  console.log('dist/bookmarklet.min.js  ' + min.length + ' bytes');
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
<title>Practice Video ToC bookmarklet</title>
<style>
  :root { --ebony:#1B1815; --raised:#2A2521; --ivory:#EDE4CF; --dim:#AFA592; --mid:#CFC5B0; --baize:#5C8A6A; --rule:rgba(237,228,207,.14); }
  html { background:var(--ebony); }
  body { margin:0; padding:40px 16px 64px; color:var(--mid); font:16px/1.55 ui-sans-serif,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif; }
  main { max-width:620px; margin:0 auto; }
  h1 { color:var(--ivory); font-size:26px; font-weight:600; margin:0 0 4px; }
  .version { color:var(--dim); font-size:14px; margin:0 0 28px; }
  h2 { color:var(--ivory); font-size:17px; font-weight:600; margin:32px 0 8px; }
  p { margin:0 0 12px; }
  ol { padding-left:22px; margin:0 0 12px; }
  li { margin:0 0 6px; }
  b { color:var(--ivory); font-weight:600; }
  kbd { font:inherit; color:var(--ivory); background:var(--raised); border-radius:4px; padding:1px 6px; }
  .drag { display:block; margin:18px 0 10px; text-align:center; padding:16px 20px; background:var(--raised); color:var(--ivory); text-decoration:none;
          border:2px dashed var(--baize); border-radius:8px; font-size:18px; font-weight:600; cursor:grab; }
  .drag:active { cursor:grabbing; }
  .copybox { display:flex; gap:8px; margin:10px 0 4px; }
  textarea { flex:1; height:72px; background:var(--ebony); color:var(--dim); border:1px solid var(--rule); border-radius:6px; padding:8px; font:12px/1.4 ui-monospace,Menlo,Consolas,monospace; resize:vertical; }
  button { font:inherit; background:var(--raised); color:var(--ivory); border:0; border-radius:6px; padding:8px 14px; cursor:pointer; align-self:flex-start; }
  button:hover { background:#35302A; }
  button:focus-visible, .drag:focus-visible { outline:2px solid var(--baize); outline-offset:2px; }
  .note { color:var(--dim); font-size:14px; }
  hr { border:0; border-top:1px solid var(--rule); margin:32px 0; }
</style>
</head>
<body>
<main>
  <h1>Practice Video ToC bookmarklet</h1>
  <p class="version">Version ${version}. Adds a clickable table of contents, keyboard shortcuts and optional MIDI control to the practice session videos.</p>

  <h2>1. Show your bookmarks bar</h2>
  <p>Chrome: <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>B</kbd> on Windows, <kbd>⌘</kbd>+<kbd>Shift</kbd>+<kbd>B</kbd> on Mac.
     Safari: View → Show Favorites Bar.</p>

  <h2>2. Add the bookmarklet</h2>
  <p>Drag this link onto your bookmarks bar:</p>
  <a class="drag" href="${href}" onclick="return false" title="Drag me to the bookmarks bar">MK Video ToC bookmarklet</a>
  <p class="note">Drag the box above onto the bookmarks bar. Clicking it here does nothing. The bookmark will be named "MK Video ToC bookmarklet".</p>
  <p class="note">If dragging doesn't work (Safari, or some touchpads): copy the text below, add any bookmark, then edit it and paste this text in place of its address.
     In Safari that is Bookmarks → Edit Bookmarks, right-click the bookmark, Edit Address.</p>
  <div class="copybox">
    <textarea id="code" readonly spellcheck="false">${escapeAttr(url)}</textarea>
    <button id="copy" type="button">Copy</button>
  </div>

  <h2>3. Use it</h2>
  <ol>
    <li>Open a practice session post and press <b>play</b> on the video.</li>
    <li>Click the <b>MK Video ToC bookmarklet</b> bookmark. The contents panel appears on the right.</li>
    <li>Click any entry to jump there. <kbd>Alt</kbd>+<kbd>→</kbd> / <kbd>Alt</kbd>+<kbd>←</kbd> (Option on Mac) step between timestamps.</li>
  </ol>
  <p class="note">The bookmarklet only does anything on ${hostList}. It reads the tables of contents from a private list and sends nothing anywhere.
     Safari does not support MIDI control; everything else works there.</p>

  <hr>
  <p class="note">To update to a newer version, come back to this page and drag the link again, then delete the old bookmark. The panel's title shows its version when you hover over it.</p>

  <h2>Checking what you installed</h2>
  <p class="note">The source code is public${repoUrl ? ' at <a href="' + repoUrl + '">' + repoUrl + '</a>' : ''}. The bookmarklet is that code with three values filled in
     (the gist that holds the tables of contents, and the course site's hostname) and nothing else. To confirm:</p>
  <ol class="note">
    <li>Edit the bookmark, copy its address into a file called <code>installed.txt</code>.</li>
    <li>Its SHA-256 should be <code style="word-break:break-all">${sha256}</code> for version ${version}. With Node installed:
        <code>node -e "const c=require('crypto'),f=require('fs');console.log(c.createHash('sha256').update(f.readFileSync('installed.txt','utf8').trim()).digest('hex'))"</code></li>
    <li>Or decode and read it: <code>node -e "console.log(decodeURIComponent(require('fs').readFileSync('installed.txt','utf8').trim().slice(11)))"</code>
        prints plain JavaScript identical to <code>dist/bookmarklet.shipped.js</code> from a build of the public repo with the same values
        (compare with <code>diff</code>).</li>
  </ol>
</main>
<script>
  document.getElementById('copy').addEventListener('click', function () {
    var ta = document.getElementById('code');
    var done = function () { this.textContent = 'Copied'; setTimeout(function (b) { b.textContent = 'Copy'; }, 1500, this); }.bind(this);
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(ta.value).then(done, function () { ta.select(); });
    else { ta.select(); try { document.execCommand('copy'); done(); } catch (e) {} }
  });
</script>
</body>
</html>
`;
}

main().catch(err => { console.error(err); process.exit(1); });
