/*
 * Billing-key tests protect the books workflow where one visible action can
 * span apply and preview requests without consuming quota twice.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertServiceQuota,
  buildPlanServicesSummary,
  recordUsageEvent,
  resolveExistingUsageCharge,
} from './access-usage.service.js';
import { ACCESS_PLAN_TYPES } from './access-policy.constants.js';

test('billing keys let related books requests share one quota charge', () => {
  const actorKey = `test-access-actor-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const billingKey = `books-session-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const serviceKey = 'books_greek_editor';
  const servicePolicy = {
    preset: '100000_words',
    kind: 'words_total',
    wordsTotal: 100000,
  };

  recordUsageEvent({
    actorType: ACCESS_PLAN_TYPES.TOKEN,
    actorKey,
    serviceKey,
    operationName: 'books_greek_editor_apply',
    planType: ACCESS_PLAN_TYPES.TOKEN,
    billingKey,
    status: 'success',
    consumedRequests: 1,
    consumedWords: 75000,
    metadata: { inputType: 'docx' },
  });

  const existingCharge = resolveExistingUsageCharge({
    actorKey,
    serviceKey,
    billingKey,
  });

  assert.deepEqual(existingCharge, {
    consumedRequests: 1,
    consumedWords: 75000,
  });

  assert.doesNotThrow(() =>
    assertServiceQuota({
      actorKey,
      serviceKey,
      servicePolicy,
      incomingRequests: 1,
      incomingWords: 75000,
      billingKey,
    }),
  );

  assert.throws(
    () =>
      assertServiceQuota({
        actorKey,
        serviceKey,
        servicePolicy,
        incomingRequests: 1,
        incomingWords: 75000,
      }),
    /Word limit reached/,
  );

  const [summary] = buildPlanServicesSummary({
    actorKey,
    planType: ACCESS_PLAN_TYPES.TOKEN,
    servicePolicies: {
      [serviceKey]: servicePolicy,
    },
  }).filter((item) => item.serviceKey === serviceKey);

  assert.equal(summary.usage.cycleWords, 75000);
  assert.equal(summary.quota.words.remaining, 25000);
});

test('usageResetAt zeros current counters without deleting history', () => {
  const actorKey = `test-reset-actor-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const serviceKey = 'books_greek_editor';
  const servicePolicy = {
    preset: '300000_words',
    kind: 'words_total',
    wordsTotal: 300000,
  };
  const createdAt = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const resetAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();

  recordUsageEvent({
    actorType: ACCESS_PLAN_TYPES.TOKEN,
    actorKey,
    serviceKey,
    operationName: 'books_greek_editor_apply',
    planType: ACCESS_PLAN_TYPES.TOKEN,
    status: 'success',
    consumedRequests: 1,
    consumedWords: 75000,
    metadata: { inputType: 'docx' },
  });

  const [summary] = buildPlanServicesSummary({
    actorKey,
    planType: ACCESS_PLAN_TYPES.TOKEN,
    servicePolicies: {
      [serviceKey]: servicePolicy,
    },
    usageCycleStartedAt: createdAt,
    usageResetAt: resetAt,
    now: new Date(Date.now() + 2 * 60 * 60 * 1000),
  }).filter((item) => item.serviceKey === serviceKey);

  assert.equal(summary.usage.cycleWords, 0);
  assert.equal(summary.usage.dailyRequests, 0);
  assert.equal(summary.quota.words.used, 0);
  assert.equal(summary.quota.words.remaining, 300000);
  assert.equal(summary.quota.words.resetAt, resetAt);
});
