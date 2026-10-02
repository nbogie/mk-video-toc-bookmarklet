// Publish dist/install.html to the unlisted Netlify site. Requires `npx netlify-cli login` once.
// Usage: npm run deploy   (runs the build first)
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const { requireEnv } = require('./env.js');
const NETLIFY_CLI = 'netlify-cli@27.10.2'; // pinned; run via npx, never a project dependency

// NETLIFY_SITE_ID and INSTALL_PAGE_URL live in .env (the page embeds the gist id, so its
// address is not written anywhere in this repo).
const env = requireEnv(['NETLIFY_SITE_ID', 'INSTALL_PAGE_URL']);
const SITE_ID = env.NETLIFY_SITE_ID;

const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
const src = path.join(__dirname, 'dist', 'install.html');
if (!fs.existsSync(src)) { console.error('dist/install.html missing — run npm run build'); process.exit(1); }

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mk-toc-site-'));
fs.copyFileSync(src, path.join(dir, 'index.html'));
fs.writeFileSync(path.join(dir, '_headers'), '/*\n  X-Robots-Tag: noindex, nofollow\n  Referrer-Policy: no-referrer\n');

execFileSync('npx', ['-y', NETLIFY_CLI, 'deploy', '--prod', '--dir=' + dir, '--site=' + SITE_ID, '--message', 'v' + pkg.version + ' install page'],
  { stdio: 'inherit' });
fs.rmSync(dir, { recursive: true, force: true });
console.log('Published v' + pkg.version + ' to ' + env.INSTALL_PAGE_URL);
