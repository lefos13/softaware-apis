/*
Runs Husky through Node so npm install does not depend on shell-specific
resolution of the husky binary on Windows. If Husky is intentionally disabled
or not installed, the install continues without failing.
*/
const { execFileSync } = require('node:child_process');

if (process.env.HUSKY === '0') {
  process.exit(0);
}

try {
  require.resolve('husky/package.json');
} catch {
  process.exit(0);
}

const command = process.platform === 'win32' ? 'npx.cmd' : 'npx';
execFileSync(command, ['husky'], { stdio: 'inherit' });