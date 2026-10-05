// Builds dist/PostAdmin-Setup-<version>.exe from installer/postadmin.iss.
//
// The installer ships the official node.exe from nodejs.org (Authenticode-signed by the OpenJS Foundation)
// plus the app's JS files, instead of the pkg-built postadmin.exe. pkg binaries are unsigned, and Windows
// Smart App Control blocks unsigned executables.
//
// Expects dist/PostAdmin-Launcher.exe (npm run build:launcher).
const { execFileSync, execSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const STAGE = path.join(DIST, 'stage');
const NODE_LINE = 'latest-v22.x';
const { version } = require('../package.json');

function findIscc() {
  const candidates = [
    process.env.ISCC,
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs', 'Inno Setup 6', 'ISCC.exe'),
    process.env['ProgramFiles(x86)'] && path.join(process.env['ProgramFiles(x86)'], 'Inno Setup 6', 'ISCC.exe'),
    process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Inno Setup 6', 'ISCC.exe'),
  ].filter(Boolean);
  return candidates.find(p => fs.existsSync(p)) || 'ISCC.exe';
}

// Downloads the official win-x64 node.exe (cached in dist/cache) and checks it against SHASUMS256.txt.
async function getNodeExe() {
  const base = `https://nodejs.org/dist/${NODE_LINE}/`;
  const sums = await (await fetch(base + 'SHASUMS256.txt')).text();
  const line = sums.split('\n').find(l => l.trim().endsWith(' win-x64/node.exe'));
  const tarball = sums.split('\n').find(l => /node-(v[\d.]+)\.tar\.gz$/.test(l));
  if (!line || !tarball) throw new Error('Could not read Node SHASUMS256.txt');
  const sha = line.split(/\s+/)[0];
  const nodeVersion = tarball.match(/node-(v[\d.]+)\.tar\.gz$/)[1];

  const cached = path.join(DIST, 'cache', `node-${nodeVersion}-win-x64.exe`);
  if (!fs.existsSync(cached)) {
    console.log(`Downloading Node ${nodeVersion} (win-x64)...`);
    const res = await fetch(base + 'win-x64/node.exe');
    if (!res.ok) throw new Error(`node.exe download failed: HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    const got = crypto.createHash('sha256').update(buf).digest('hex');
    if (got !== sha) throw new Error(`node.exe checksum mismatch (expected ${sha}, got ${got})`);
    fs.mkdirSync(path.dirname(cached), { recursive: true });
    fs.writeFileSync(cached, buf);
  }
  return { file: cached, nodeVersion };
}

async function stage() {
  fs.rmSync(STAGE, { recursive: true, force: true });
  const server = path.join(STAGE, 'server');
  const app = path.join(server, 'app');
  fs.mkdirSync(app, { recursive: true });

  const node = await getNodeExe();
  fs.copyFileSync(node.file, path.join(server, 'node.exe'));

  for (const f of ['package.json', 'package-lock.json']) fs.copyFileSync(path.join(ROOT, f), path.join(app, f));
  for (const d of ['src', 'public']) fs.cpSync(path.join(ROOT, d), path.join(app, d), { recursive: true });
  console.log('Installing production dependencies...');
  execSync('npm ci --omit=dev --ignore-scripts --no-audit --no-fund', { cwd: app, stdio: 'inherit' });
  return node.nodeVersion;
}

async function main() {
  if (!fs.existsSync(path.join(DIST, 'PostAdmin-Launcher.exe'))) {
    console.error('dist/PostAdmin-Launcher.exe not found. Run `npm run build:launcher` first.');
    process.exit(1);
  }
  const nodeVersion = await stage();
  console.log(`Staged Node ${nodeVersion} + app in dist/stage`);
  try {
    execFileSync(findIscc(), [`/DAppVersion=${version}`, path.join(ROOT, 'installer', 'postadmin.iss')], { stdio: 'inherit' });
  } catch (err) {
    if (err.code === 'ENOENT') {
      console.error('Inno Setup 6 (ISCC.exe) not found. Install it from https://jrsoftware.org/isdl.php or set ISCC to its path.');
    }
    process.exit(1);
  }
  console.log(`\nBuilt dist/PostAdmin-Setup-${version}.exe`);
}

main().catch(err => { console.error(err.message); process.exit(1); });
