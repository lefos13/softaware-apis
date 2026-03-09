/*
 * Shared plan constants keep admin token policies, free-plan defaults, quota
 * summaries, and route enforcement aligned around one service vocabulary.
 */
import { ACCESS_TOKEN_SERVICE_FLAGS } from '../admin/admin-token.constants.js';

export const ACCESS_PLAN_TYPES = {
  FREE: 'free',
  TOKEN: 'token',
};

export const ACCESS_SERVICE_KEYS = ACCESS_TOKEN_SERVICE_FLAGS;
export const ACCESS_SERVICE_KEY_LIST = Object.freeze(Object.values(ACCESS_SERVICE_KEYS));

export const DAILY_RESET_TIMEZONE = 'UTC';
export const HISTORY_RETENTION_DAYS = 180;

const buildUnlimitedPolicy = (preset) => ({
  preset,
  kind: 'unlimited',
});

const buildRequestPolicy = (preset, requestsPerDay) => ({
  preset,
  kind: 'requests_per_day',
  requestsPerDay,
});

const buildWordsPolicy = (preset, wordsTotal) => ({
  preset,
  kind: 'words_total',
  wordsTotal,
});

const buildCompositePolicy = (preset, payload) => ({
  preset,
  kind: 'composite',
  ...payload,
});

export const ACCESS_TOKEN_SERVICE_POLICY_PRESETS = Object.freeze({
  [ACCESS_SERVICE_KEYS.BOOKS_GREEK_EDITOR]: Object.freeze({
    '100000_words': buildWordsPolicy('100000_words', 100000),
    '300000_words': buildWordsPolicy('300000_words', 300000),
    unlimited: buildUnlimitedPolicy('unlimited'),
  }),
  [ACCESS_SERVICE_KEYS.IMAGE]: Object.freeze({
    '20_per_day': buildRequestPolicy('20_per_day', 20),
    unlimited: buildUnlimitedPolicy('unlimited'),
  }),
  [ACCESS_SERVICE_KEYS.PDF]: Object.freeze({
    '30_per_day': buildRequestPolicy('30_per_day', 30),
    unlimited: buildUnlimitedPolicy('unlimited'),
  }),
  [ACCESS_SERVICE_KEYS.TASKS]: Object.freeze({
    unlimited: buildUnlimitedPolicy('unlimited'),
  }),
});

export const FREE_ACCESS_SERVICE_POLICIES = Object.freeze({
  [ACCESS_SERVICE_KEYS.BOOKS_GREEK_EDITOR]: Object.freeze(
    buildCompositePolicy('free_default', {
      requestsPerDay: 1,
      wordsTotal: 10000,
    }),
  ),
  [ACCESS_SERVICE_KEYS.IMAGE]: Object.freeze(buildRequestPolicy('free_default', 3)),
  [ACCESS_SERVICE_KEYS.PDF]: Object.freeze(buildRequestPolicy('free_default', 3)),
  [ACCESS_SERVICE_KEYS.TASKS]: Object.freeze(buildUnlimitedPolicy('free_default')),
});

export const DEFAULT_LEGACY_TOKEN_SERVICE_POLICIES = Object.freeze(
  ACCESS_SERVICE_KEY_LIST.reduce((accumulator, serviceKey) => {
    accumulator[serviceKey] = ACCESS_TOKEN_SERVICE_POLICY_PRESETS[serviceKey].unlimited;
    return accumulator;
  }, {}),
);

export const getTokenPolicyPresetNames = (serviceKey) =>
  Object.keys(ACCESS_TOKEN_SERVICE_POLICY_PRESETS[serviceKey] || {});

export const clonePolicy = (policy) => {
  if (!policy) {
    return null;
  }

  return JSON.parse(JSON.stringify(policy));
};

export const deriveServiceFlagsFromPolicies = (servicePolicies) =>
  ACCESS_SERVICE_KEY_LIST.filter((serviceKey) => Boolean(servicePolicies?.[serviceKey]));

export const getUtcDayWindow = (value = Date.now()) => {
  const sourceDate = value instanceof Date ? value : new Date(value);
  const startMs = Date.UTC(
    sourceDate.getUTCFullYear(),
    sourceDate.getUTCMonth(),
    sourceDate.getUTCDate(),
    0,
    0,
    0,
    0,
  );
  const endMs = startMs + 24 * 60 * 60 * 1000;

  return {
    startAt: new Date(startMs).toISOString(),
    endAt: new Date(endMs).toISOString(),
  };
};
