// Checks GitHub for a newer PostAdmin release. Results are cached; failures (offline, rate limit) report no update.
const { version } = require('../package.json');

const REPO = 'haseebkhan4321/postgres-sql-ui';
const CACHE_MS = 6 * 60 * 60 * 1000;
const DISABLED = process.env.POSTADMIN_NO_UPDATE_CHECK === '1';

let cached = null;
let cachedAt = 0;

function parse(v) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(v || '');
  return m ? m.slice(1).map(Number) : null;
}

function isNewer(latest, current) {
  const a = parse(latest), b = parse(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}

async function fetchLatest() {
  const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': `PostAdmin/${version}` },
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`GitHub responded ${res.status}`);
  const rel = await res.json();
  const latest = rel.tag_name.replace(/^v/, '');
  const setup = (rel.assets || []).find(a => /^PostAdmin-Setup-.*\.exe$/i.test(a.name));
  return {
    current: version,
    latest,
    available: isNewer(latest, version),
    releaseUrl: rel.html_url,
    downloadUrl: setup ? setup.browser_download_url : rel.html_url,
  };
}

async function checkForUpdate() {
  if (DISABLED) return { current: version, available: false, disabled: true };
  if (cached && Date.now() - cachedAt < CACHE_MS) return cached;
  try {
    cached = await fetchLatest();
  } catch {
    // Retry in 10 minutes instead of 6 hours.
    cached = { current: version, available: false };
    cachedAt = Date.now() - CACHE_MS + 10 * 60 * 1000;
    return cached;
  }
  cachedAt = Date.now();
  return cached;
}

module.exports = { checkForUpdate, isNewer };
