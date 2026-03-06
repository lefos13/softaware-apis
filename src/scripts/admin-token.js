/*
 * Token minting stays server-side so admin credentials can be created with
 * role/owner/expiry controls without exposing creation through public APIs.
 */
import { createAdminToken, parseTokenTtl } from '../modules/admin/admin-token.service.js';

const usageText = `
[softaware-apis] Admin token creation

Usage:
  npm run admin:token:create -- --role=admin --owner-id=public --ttl=30d
  npm run admin:token:create -- --role=superadmin --owner-id=global --ttl=30d

Options:
  --role=admin|superadmin
  --owner-id=<scope owner id>
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

const role = String(args.role || 'admin')
  .trim()
  .toLowerCase();
const ownerId = String(args['owner-id'] || 'public').trim();
const ttlRaw = String(args.ttl || '30d').trim();

try {
  const ttlSeconds = parseTokenTtl(ttlRaw);
  const created = createAdminToken({
    role,
    ownerId,
    ttlSeconds,
  });

  console.log('[softaware-apis] Admin token created. Store this token securely; it is shown once.');
  console.log('');
  console.log(`token=${created.token}`);
  console.log(`role=${created.role}`);
  console.log(`ownerId=${created.ownerId}`);
  console.log(`tokenId=${created.tokenId}`);
  console.log(`expiresAt=${created.expiresAt}`);
} catch (error) {
  console.error(`[softaware-apis] token creation failed: ${error?.message || 'Unknown error'}`);
  console.error('');
  console.error(usageText);
  process.exit(1);
}
