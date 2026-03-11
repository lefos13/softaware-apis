/*
 * Token-request tests protect the approval inbox flow so pending requests,
 * email-triggered state changes, and admin actions remain recoverable.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { env } from '../../config/env.js';
import {
  approveTokenRequest,
  buildAccessPlanCatalog,
  createTokenRequest,
  listTokenRequests,
  rejectTokenRequest,
} from './access-request.service.js';

const originalStoreFile = env.tokenRequestStoreFile;
const originalDefaultTtl = env.tokenRequestDefaultTtl;
const testStoreFile = resolve(process.cwd(), 'tmp', 'access-request-service.test.json');

const resetStore = () => {
  if (existsSync(testStoreFile)) {
    rmSync(testStoreFile, { force: true });
  }
};

test.before(() => {
  mkdirSync(dirname(testStoreFile), { recursive: true });
  env.tokenRequestStoreFile = testStoreFile;
  env.tokenRequestDefaultTtl = '30d';
  resetStore();
});

test.after(() => {
  resetStore();
  env.tokenRequestStoreFile = originalStoreFile;
  env.tokenRequestDefaultTtl = originalDefaultTtl;
});

test('catalog exposes free and paid service plans', () => {
  const catalog = buildAccessPlanCatalog();

  assert.equal(catalog.freePlan.planType, 'free');
  assert.ok(Array.isArray(catalog.freePlan.services));
  assert.ok(Array.isArray(catalog.paidPlans));
  assert.equal(catalog.requestDefaults.ttl, '30d');
});

test('createTokenRequest stores a pending request and lists it for admins', () => {
  resetStore();

  const request = createTokenRequest({
    alias: 'Editorial team',
    email: 'editor@example.com',
    servicePolicies: {
      books_greek_editor: '300000_words',
      pdf: '30_per_day',
    },
  });

  assert.equal(request.status, 'pending');
  assert.equal(request.email, 'editor@example.com');

  const listed = listTokenRequests();
  assert.equal(listed.count, 1);
  assert.equal(listed.pendingCount, 1);
  assert.deepEqual(listed.requests[0].servicePolicies, {
    books_greek_editor: '300000_words',
    pdf: '30_per_day',
  });
});

test('approveTokenRequest creates the token, sends email, and marks the request approved', async () => {
  resetStore();

  const request = createTokenRequest({
    alias: 'Proofreader',
    email: 'proofreader@example.com',
    servicePolicies: {
      books_greek_editor: '100000_words',
    },
  });

  let emailedToken = '';
  const result = await approveTokenRequest({
    requestId: request.requestId,
    actorTokenId: 'superadmin-token-id',
    createAccessTokenImpl: ({ alias, servicePolicies, ttlSeconds, actorTokenId }) => ({
      token: 'sat_test_approved',
      record: {
        tokenId: 'tok-approved',
        alias,
        servicePolicies,
        ttlSeconds,
        actorTokenId,
      },
    }),
    sendEmailImpl: async ({ text }) => {
      emailedToken = String(text || '');
      return { messageId: 'msg-1' };
    },
  });

  assert.equal(result.request.status, 'approved');
  assert.equal(result.request.resolvedTokenId, 'tok-approved');
  assert.match(emailedToken, /sat_test_approved/);

  const listed = listTokenRequests();
  assert.equal(listed.pendingCount, 0);
  assert.equal(listed.requests[0].status, 'approved');
});

test('rejectTokenRequest leaves the request pending when email delivery fails', async () => {
  resetStore();

  const request = createTokenRequest({
    alias: 'Image desk',
    email: 'images@example.com',
    servicePolicies: {
      image: '20_per_day',
    },
  });

  await assert.rejects(
    () =>
      rejectTokenRequest({
        requestId: request.requestId,
        actorTokenId: 'superadmin-token-id',
        reason: 'Not enough quota available',
        sendEmailImpl: async () => {
          throw new Error('SMTP timeout');
        },
      }),
    /SMTP timeout/,
  );

  const listed = listTokenRequests();
  assert.equal(listed.pendingCount, 1);
  assert.equal(listed.requests[0].status, 'pending');
  assert.match(String(listed.requests[0].lastEmailError || ''), /SMTP timeout/);
});
