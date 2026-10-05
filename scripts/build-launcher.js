// Compiles launcher/Launcher.cs into dist/PostAdmin-Launcher.exe with the C# compiler
// that ships with .NET Framework 4.x (present on every Windows 10/11 machine).
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const { version } = require('../package.json');

const csc = path.join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
if (!fs.existsSync(csc)) {
  console.error(`C# compiler not found at ${csc}. The launcher can only be built on Windows.`);
  process.exit(1);
}

const versionFile = path.join(os.tmpdir(), 'postadmin-launcher-version.cs');
fs.writeFileSync(versionFile, [
  'using System.Reflection;',
  `[assembly: AssemblyTitle("PostAdmin")]`,
  `[assembly: AssemblyProduct("PostAdmin")]`,
  `[assembly: AssemblyVersion("${version}.0")]`,
  `[assembly: AssemblyFileVersion("${version}.0")]`,
  'namespace PostAdminLauncher { static class BuildInfo { public const string Version = "' + version + '"; } }',
  '',
].join('\n'));

fs.mkdirSync(path.join(ROOT, 'dist'), { recursive: true });
const out = path.join(ROOT, 'dist', 'PostAdmin-Launcher.exe');
execFileSync(csc, [
  '/nologo', '/target:winexe', '/platform:anycpu', '/optimize+',
  `/out:${out}`,
  `/win32icon:${path.join(ROOT, 'launcher', 'postadmin.ico')}`,
  '/r:System.dll', '/r:System.Drawing.dll', '/r:System.Windows.Forms.dll',
  path.join(ROOT, 'launcher', 'Launcher.cs'),
  versionFile,
], { stdio: 'inherit' });
console.log(`Built ${path.relative(ROOT, out)}`);
