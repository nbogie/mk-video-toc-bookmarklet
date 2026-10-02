// Minimal .env loader shared by build.js and deploy.js. No dependency: KEY=value per line,
// '#' comments, optional quotes. Real environment variables take precedence over the file.
const fs = require('fs');
const path = require('path');

function loadDotEnv(dir) {
  const envPath = path.join(dir || __dirname, '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

// Returns the named variables, or exits with a message naming the missing ones.
function requireEnv(names, hint) {
  loadDotEnv(__dirname);
  const out = {};
  const missing = [];
  for (const n of names) { if (process.env[n]) out[n] = process.env[n]; else missing.push(n); }
  if (missing.length) {
    console.error('Missing configuration: ' + missing.join(', ') + '\n' + (hint || 'Copy .env.example to .env and fill it in, or set the variables in the environment.'));
    process.exit(1);
  }
  return out;
}

// Build identifier from git: "<version>+<short-hash>" plus "-dirty" when the working tree has
// uncommitted changes, or "+unknown" outside a git checkout. Deterministic for clean builds.
function buildId(version) {
  let hash = 'unknown', dirty = false;
  try {
    const { execFileSync } = require('child_process');
    const opts = { cwd: __dirname, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] };
    hash = execFileSync('git', ['rev-parse', '--short', 'HEAD'], opts).trim();
    dirty = execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], opts).trim().length > 0;
  } catch (err) { /* not a git checkout, or git missing */ }
  return version + '+' + hash + (dirty ? '-dirty' : '');
}

module.exports = { loadDotEnv, requireEnv, buildId };
