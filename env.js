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

module.exports = { loadDotEnv, requireEnv };
