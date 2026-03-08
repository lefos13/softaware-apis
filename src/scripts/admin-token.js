/*
 * Superadmin bootstrap tokens stay CLI-only so the browser can manage access
 * tokens without ever gaining the ability to mint control-plane credentials.
 */
import { createSuperAdminToken, parseTokenTtl } from '../modules/admin/admin-token.service.js';

const usageText = `
[softaware-apis] Superadmin token creation

Usage:
  npm run admin:token:create -- --alias="Primary superadmin" --ttl=30d

Options:
  --alias=<friendly label for the superadmin token>
  --ttl=<duration such as 30m, 24h, 30d>
`.trim();

const parseArgs = (argv) => {
  const out = {};

  for (const token of argv) {
    if (!token.startsWith('--')) {
      continue;
    }

    const [key, ...rest] = token.slice(2).split('=');
    out[key] = rest.join('=');
  }

  return out;
};

const args = parseArgs(process.argv.slice(2));
if (args.help !== undefined) {
  console.log(usageText);
  process.exit(0);
}

const alias = String(args.alias || 'CLI superadmin').trim();
const ttlRaw = String(args.ttl || '30d').trim();

try {
  const ttlSeconds = parseTokenTtl(ttlRaw);
  const created = createSuperAdminToken({
    alias,
    ttlSeconds,
  });

  console.log(
    '[softaware-apis] Superadmin token created. Store this token securely; it is shown once.',
  );
  console.log('');
  console.log(`token=${created.token}`);
  console.log(`tokenType=${created.tokenType}`);
  console.log(`alias=${created.alias}`);
  console.log(`tokenId=${created.tokenId}`);
  console.log(`expiresAt=${created.expiresAt}`);
} catch (error) {
  console.error(`[softaware-apis] token creation failed: ${error?.message || 'Unknown error'}`);
  console.error('');
  console.error(usageText);
  process.exit(1);
}
