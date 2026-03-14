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
  assert.ok(Array.isArray(catalog.premiumPlans));
  assert.equal(catalog.premiumPlans[0].presets[0].pricing.currency, 'EUR');
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
  assert.equal(request.pricing.totalAmount, 158);

  const listed = listTokenRequests();
  assert.equal(listed.count, 1);
  assert.equal(listed.pendingCount, 1);
  assert.deepEqual(listed.requests[0].servicePolicies, {
    books_greek_editor: '300000_words',
    pdf: '30_per_day',
  });
  assert.equal(listed.requests[0].pricing.totalAmount, 158);
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
  let emailedHtml = '';
  let capturedPricingSnapshot = null;
  const result = await approveTokenRequest({
    requestId: request.requestId,
    actorTokenId: 'superadmin-token-id',
    createAccessTokenImpl: ({
      alias,
      servicePolicies,
      ttlSeconds,
      actorTokenId,
      pricingSnapshot,
    }) => {
      capturedPricingSnapshot = pricingSnapshot;
      return {
        token: 'sat_test_approved',
        record: {
          tokenId: 'tok-approved',
          alias,
          servicePolicies,
          pricing: pricingSnapshot,
          ttlSeconds,
          actorTokenId,
        },
      };
    },
    sendEmailImpl: async ({ text, html }) => {
      emailedToken = String(text || '');
      emailedHtml = String(html || '');
      return { messageId: 'msg-1' };
    },
  });

  assert.equal(result.request.status, 'approved');
  assert.equal(result.request.resolvedTokenId, 'tok-approved');
  assert.equal(result.request.pricing.totalAmount, 49);
  assert.equal(capturedPricingSnapshot.totalAmount, 49);
  assert.match(emailedToken, /sat_test_approved/);
  assert.match(emailedToken, /Token id: tok-approved/);
  assert.match(emailedToken, /Γεια σας/);
  assert.match(emailedHtml, /Approved \/ Εγκρίθηκε/);
  assert.match(emailedHtml, /Token id \/ Αναγνωριστικό token/);
  assert.match(emailedHtml, /tok-approved/);
  assert.match(emailedHtml, /table role="presentation"/);

  const listed = listTokenRequests();
  assert.equal(listed.pendingCount, 0);
  assert.equal(listed.requests[0].status, 'approved');
});

test('rejectTokenRequest sends a user-friendly bilingual email and marks request rejected', async () => {
  resetStore();

  const request = createTokenRequest({
    alias: 'Image desk',
    email: 'images@example.com',
    servicePolicies: {
      image: '20_per_day',
    },
  });

  let emailedText = '';
  let emailedHtml = '';
  const result = await rejectTokenRequest({
    requestId: request.requestId,
    actorTokenId: 'superadmin-token-id',
    reason: 'Not enough quota available',
    sendEmailImpl: async ({ text, html }) => {
      emailedText = String(text || '');
      emailedHtml = String(html || '');
      return { messageId: 'msg-2' };
    },
  });

  assert.equal(result.request.status, 'rejected');
  assert.equal(result.request.rejectionReason, 'Not enough quota available');
  assert.equal(result.request.pricing.totalAmount, 29);
  assert.match(emailedText, /Not enough quota available/);
  assert.match(emailedText, /Μπορείτε να στείλετε νέο αίτημα/);
  assert.match(emailedHtml, /Update \/ Ενημέρωση/);
  assert.match(emailedHtml, /Reason \/ Αιτία/);
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
