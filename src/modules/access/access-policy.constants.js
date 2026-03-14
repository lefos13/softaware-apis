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
export const ACCESS_PRICING_BILLING_MODES = Object.freeze({
  ONE_TIME: 'one_time',
});
export const ACCESS_PREMIUM_PRICING_DEFAULTS = Object.freeze({
  currency: 'EUR',
  billingMode: ACCESS_PRICING_BILLING_MODES.ONE_TIME,
});

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

const buildPremiumPreset = (policy, amount, overrides = {}) => ({
  policy,
  pricing: {
    amount,
    currency: ACCESS_PREMIUM_PRICING_DEFAULTS.currency,
    billingMode: ACCESS_PREMIUM_PRICING_DEFAULTS.billingMode,
    ...overrides,
  },
});

/*
 * Premium preset config keeps quota rules and quote amounts in one backend
 * source so catalog output, request totals, and stored token pricing do not drift.
 */
export const ACCESS_PREMIUM_SERVICE_PRESET_CONFIG = Object.freeze({
  [ACCESS_SERVICE_KEYS.BOOKS_GREEK_EDITOR]: Object.freeze({
    '100000_words': buildPremiumPreset(buildWordsPolicy('100000_words', 100000), 49),
    '300000_words': buildPremiumPreset(buildWordsPolicy('300000_words', 300000), 119),
    unlimited: buildPremiumPreset(buildUnlimitedPolicy('unlimited'), 249),
  }),
  [ACCESS_SERVICE_KEYS.IMAGE]: Object.freeze({
    '20_per_day': buildPremiumPreset(buildRequestPolicy('20_per_day', 20), 29),
    unlimited: buildPremiumPreset(buildUnlimitedPolicy('unlimited'), 89),
  }),
  [ACCESS_SERVICE_KEYS.PDF]: Object.freeze({
    '30_per_day': buildPremiumPreset(buildRequestPolicy('30_per_day', 30), 39),
    unlimited: buildPremiumPreset(buildUnlimitedPolicy('unlimited'), 99),
  }),
  [ACCESS_SERVICE_KEYS.TASKS]: Object.freeze({
    unlimited: buildPremiumPreset(buildUnlimitedPolicy('unlimited'), 79),
  }),
});

export const ACCESS_TOKEN_SERVICE_POLICY_PRESETS = Object.freeze(
  Object.fromEntries(
    Object.entries(ACCESS_PREMIUM_SERVICE_PRESET_CONFIG).map(([serviceKey, presets]) => [
      serviceKey,
      Object.freeze(
        Object.fromEntries(
          Object.entries(presets).map(([presetKey, presetConfig]) => [
            presetKey,
            presetConfig.policy,
          ]),
        ),
      ),
    ]),
  ),
);

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

export const getPremiumPresetPricing = (serviceKey, preset) => {
  const pricing = ACCESS_PREMIUM_SERVICE_PRESET_CONFIG?.[serviceKey]?.[preset]?.pricing;
  return pricing ? clonePolicy(pricing) : null;
};

/*
 * Stored pricing snapshots keep the original quote on the request and token
 * even after preset configuration changes later in the backend.
 */
export const buildPremiumPricingSnapshot = (selectedPolicies) => {
  const entries = Object.entries(selectedPolicies || {});
  const items = entries.map(([serviceKey, presetValue]) => {
    const preset =
      typeof presetValue === 'object' && presetValue !== null
        ? String(presetValue.preset || '').trim()
        : String(presetValue || '').trim();
    const pricing = getPremiumPresetPricing(serviceKey, preset);

    if (!pricing) {
      return null;
    }

    return {
      serviceKey,
      preset,
      amount: Number(pricing.amount),
      currency: String(pricing.currency || ACCESS_PREMIUM_PRICING_DEFAULTS.currency),
      billingMode: String(pricing.billingMode || ACCESS_PREMIUM_PRICING_DEFAULTS.billingMode),
    };
  });

  if (items.some((item) => item === null)) {
    return null;
  }

  const currency = items[0]?.currency || ACCESS_PREMIUM_PRICING_DEFAULTS.currency;
  const billingMode = items[0]?.billingMode || ACCESS_PREMIUM_PRICING_DEFAULTS.billingMode;

  return {
    totalAmount: items.reduce((sum, item) => sum + Number(item?.amount || 0), 0),
    currency,
    billingMode,
    items,
  };
};

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
