/*
 * Token service tests pin the new superadmin bootstrap flow and the access
 * token lifecycle so store migrations and editor auth checks do not regress.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { env } from '../../config/env.js';
import { ACCESS_TOKEN_SERVICE_FLAGS } from './admin-token.constants.js';
import {
  createAccessToken,
  createSuperAdminToken,
  extendAccessToken,
  listAccessTokens,
  parseTokenTtl,
  resetAccessTokenUsage,
  renewAccessToken,
  resolveStoredToken,
  revokeAccessToken,
  updateAccessToken,
} from './admin-token.service.js';

const originalStoreFile = env.adminTokenStoreFile;
const originalPepper = env.adminTokenPepper;
const testStoreFile = resolve(process.cwd(), 'tmp', 'admin-token-service.test.json');

const resetStore = () => {
  if (existsSync(testStoreFile)) {
    rmSync(testStoreFile, { force: true });
  }
};

test.before(() => {
  mkdirSync(dirname(testStoreFile), { recursive: true });
  env.adminTokenStoreFile = testStoreFile;
  env.adminTokenPepper = 'test-pepper';
  resetStore();
});

test.after(() => {
  resetStore();
  env.adminTokenStoreFile = originalStoreFile;
  env.adminTokenPepper = originalPepper;
});

test('CLI superadmin creation and access-token lifecycle work end to end', () => {
  resetStore();

  const superadmin = createSuperAdminToken({
    alias: 'Primary superadmin',
    ttlSeconds: parseTokenTtl('30d'),
  });
  assert.equal(superadmin.tokenType, 'superadmin');
  assert.equal(resolveStoredToken(superadmin.token)?.record?.tokenType, 'superadmin');

  const created = createAccessToken({
    alias: 'Books editor',
    servicePolicies: {
      [ACCESS_TOKEN_SERVICE_FLAGS.BOOKS_GREEK_EDITOR]: '100000_words',
    },
    ttlSeconds: parseTokenTtl('30d'),
    actorTokenId: superadmin.tokenId,
  });

  assert.equal(created.record.alias, 'Books editor');
  assert.deepEqual(created.record.serviceFlags, [ACCESS_TOKEN_SERVICE_FLAGS.BOOKS_GREEK_EDITOR]);
  assert.equal(created.record.pricing?.totalAmount, 49);

  const listedBeforeRevoke = listAccessTokens();
  assert.equal(listedBeforeRevoke.count, 1);
  assert.equal(listedBeforeRevoke.tokens[0].tokenType, 'access');
  assert.equal(resolveStoredToken(created.token)?.status, 'active');

  const updated = updateAccessToken({
    tokenId: created.record.tokenId,
    alias: 'Books editor updated',
    servicePolicies: {
      [ACCESS_TOKEN_SERVICE_FLAGS.BOOKS_GREEK_EDITOR]: '300000_words',
      [ACCESS_TOKEN_SERVICE_FLAGS.PDF]: '30_per_day',
    },
  });
  assert.equal(updated.alias, 'Books editor updated');
  assert.deepEqual(updated.serviceFlags, [
    ACCESS_TOKEN_SERVICE_FLAGS.BOOKS_GREEK_EDITOR,
    ACCESS_TOKEN_SERVICE_FLAGS.PDF,
  ]);
  assert.equal(updated.pricing?.totalAmount, 158);

  const revoked = revokeAccessToken({
    tokenId: created.record.tokenId,
    actorTokenId: superadmin.tokenId,
  });
  assert.equal(revoked.isRevoked, true);
  assert.equal(resolveStoredToken(created.token)?.status, 'revoked');

  const renewed = renewAccessToken({
    tokenId: created.record.tokenId,
    ttlSeconds: parseTokenTtl('14d'),
    actorTokenId: superadmin.tokenId,
  });
  assert.ok(renewed.token);
  assert.equal(renewed.record.isActive, true);
  assert.equal(resolveStoredToken(renewed.token)?.status, 'active');

  const extended = extendAccessToken({
    tokenId: created.record.tokenId,
    ttlSeconds: parseTokenTtl('7d'),
    actorTokenId: superadmin.tokenId,
  });
  assert.equal(extended.isActive, true);
  assert.ok(Date.parse(extended.expiresAt) > Date.parse(renewed.record.expiresAt));

  const resetRecord = resetAccessTokenUsage({
    tokenId: created.record.tokenId,
  });
  assert.equal(resetRecord.tokenId, created.record.tokenId);
  assert.ok(Date.parse(resetRecord.usageResetAt || ''));
});

/*
 * Token resolution must re-read the persisted store on each lookup so tokens
 * added by an external editor or sync process become valid on the next request
 * without requiring a server restart.
 */
test('resolveStoredToken picks up tokens added directly to admin-token-service store file', () => {
  resetStore();

  const created = createAccessToken({
    alias: 'Externally added token',
    servicePolicies: {
      [ACCESS_TOKEN_SERVICE_FLAGS.BOOKS_GREEK_EDITOR]: '100000_words',
    },
    ttlSeconds: parseTokenTtl('30d'),
    actorTokenId: 'external-test-actor',
  });

  const persistedStore = JSON.parse(readFileSync(testStoreFile, 'utf8'));
  const persistedRecord = persistedStore.tokens[0];

  writeFileSync(
    testStoreFile,
    `${JSON.stringify({ version: persistedStore.version, tokens: [] }, null, 2)}\n`,
    'utf8',
  );
  assert.equal(resolveStoredToken(created.token), null);

  writeFileSync(
    testStoreFile,
    `${JSON.stringify({ version: persistedStore.version, tokens: [persistedRecord] }, null, 2)}\n`,
    'utf8',
  );

  assert.equal(resolveStoredToken(created.token)?.status, 'active');
  assert.equal(resolveStoredToken(created.token)?.record?.alias, 'Externally added token');
});
