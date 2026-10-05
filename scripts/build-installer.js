// Compiles installer/postadmin.iss into dist/PostAdmin-Setup-<version>.exe.
// Expects dist/postadmin.exe to exist (run `npm run build:exe` first).
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
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

if (!fs.existsSync(path.join(ROOT, 'dist', 'postadmin.exe'))) {
  console.error('dist/postadmin.exe not found. Run `npm run build:exe` first.');
  process.exit(1);
}

try {
  execFileSync(findIscc(), [`/DAppVersion=${version}`, path.join(ROOT, 'installer', 'postadmin.iss')], { stdio: 'inherit' });
} catch (err) {
  if (err.code === 'ENOENT') {
    console.error('Inno Setup 6 (ISCC.exe) not found. Install it from https://jrsoftware.org/isdl.php or set ISCC to its path.');
  }
  process.exit(1);
}
console.log(`\nBuilt dist/PostAdmin-Setup-${version}.exe`);
