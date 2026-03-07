/**
 * Why this exists: the Greek editor needs one stable rule registry so the
 * API, the frontend checkboxes, and the text engine share the same ids/order.
 */
import { ApiError } from '../../common/utils/api-error.js';

const GREEK_LOCALE = 'el';
const GREEK_LETTER_REGEX = /\p{Script=Greek}/u;
const GREEK_VOWEL_REGEX = /[αάεέηήιίϊΐοόυύϋΰωώΑΆΕΈΗΉΙΊΪΟΌΥΎΫΏ]/u;
const OPENING_PUNCTUATION = new Set([
  ' ',
  '\t',
  '\n',
  '\r',
  '"',
  "'",
  '«',
  '“',
  '„',
  '‘',
  '(',
  '[',
  '{',
]);
const TRIMMING_CONSONANTS = new Set(['β', 'γ', 'δ', 'ζ', 'θ', 'λ', 'μ', 'ν', 'ρ', 'σ', 'φ', 'χ']);

export const BOOKS_RULE_REGISTRY = [
  {
    id: 'kai_before_vowel',
    apply: buildKaiBeforeVowelEdits,
  },
  {
    id: 'stin_article_trim',
    apply: buildStinArticleTrimEdits,
  },
  {
    id: 'min_negation_trim',
    apply: buildMinNegationTrimEdits,
  },
  {
    id: 'sa_to_san',
    apply: buildSaToSanEdits,
  },
  {
    id: 'ellipsis_normalize',
    apply: buildEllipsisEdits,
  },
];

export const BOOKS_RULE_IDS = BOOKS_RULE_REGISTRY.map((rule) => rule.id);

const isGreekLetter = (value) => GREEK_LETTER_REGEX.test(String(value || ''));

const isStandaloneWord = (text, start, end) => {
  const previous = start > 0 ? text[start - 1] : '';
  const next = end < text.length ? text[end] : '';

  return !isGreekLetter(previous) && !isGreekLetter(next);
};

const titleCase = (value) => {
  if (!value) {
    return value;
  }

  const [first, ...rest] = Array.from(value);
  return `${first.toLocaleUpperCase(GREEK_LOCALE)}${rest.join('').toLocaleLowerCase(GREEK_LOCALE)}`;
};

const applyCasePattern = (source, replacement) => {
  const upperSource = source.toLocaleUpperCase(GREEK_LOCALE);
  const lowerSource = source.toLocaleLowerCase(GREEK_LOCALE);

  if (source === upperSource) {
    return replacement.toLocaleUpperCase(GREEK_LOCALE);
  }

  if (source === titleCase(lowerSource)) {
    return titleCase(replacement);
  }

  return replacement.toLocaleLowerCase(GREEK_LOCALE);
};

const resolveNextGreekWord = (text, startIndex) => {
  let cursor = startIndex;

  while (cursor < text.length) {
    const char = text[cursor];

    if (OPENING_PUNCTUATION.has(char)) {
      cursor += 1;
      continue;
    }

    if (!isGreekLetter(char)) {
      return null;
    }

    break;
  }

  if (cursor >= text.length || !isGreekLetter(text[cursor])) {
    return null;
  }

  let end = cursor;
  while (end < text.length && isGreekLetter(text[end])) {
    end += 1;
  }

  return {
    start: cursor,
    end,
    word: text.slice(cursor, end),
  };
};

const canTrimForNextWord = (word) => {
  const normalized = String(word || '').toLocaleLowerCase(GREEK_LOCALE);
  const first = normalized[0];
  const second = normalized[1] || '';

  if (!TRIMMING_CONSONANTS.has(first)) {
    return false;
  }

  if (first === 'γ' && ['γ', 'κ'].includes(second)) {
    return false;
  }

  if (first === 'μ' && second === 'π') {
    return false;
  }

  if (first === 'ν' && second === 'τ') {
    return false;
  }

  return true;
};

const collectWordEdits = (text, expression, replacementResolver, shouldReplace) => {
  const edits = [];

  for (const match of text.matchAll(expression)) {
    const source = match[0];
    const start = match.index;
    const end = start + source.length;

    if (!isStandaloneWord(text, start, end)) {
      continue;
    }

    if (!shouldReplace(text, start, end, source)) {
      continue;
    }

    const replacement = replacementResolver(source);
    if (replacement !== source) {
      edits.push({ start, end, replacement });
    }
  }

  return edits;
};

function buildKaiBeforeVowelEdits(text) {
  return collectWordEdits(
    text,
    /και/giu,
    (source) => applyCasePattern(source, 'κι'),
    (value, _start, end) => {
      const nextWord = resolveNextGreekWord(value, end);
      return Boolean(nextWord?.word && GREEK_VOWEL_REGEX.test(nextWord.word[0]));
    },
  );
}

function buildStinArticleTrimEdits(text) {
  return collectWordEdits(
    text,
    /στην|την/giu,
    (source) =>
      applyCasePattern(source, source.toLocaleLowerCase(GREEK_LOCALE) === 'στην' ? 'στη' : 'τη'),
    (value, _start, end) => {
      const nextWord = resolveNextGreekWord(value, end);
      return Boolean(nextWord?.word && canTrimForNextWord(nextWord.word));
    },
  );
}

function buildMinNegationTrimEdits(text) {
  return collectWordEdits(
    text,
    /μην/giu,
    (source) => applyCasePattern(source, 'μη'),
    (value, _start, end) => {
      const nextWord = resolveNextGreekWord(value, end);
      return Boolean(nextWord?.word && canTrimForNextWord(nextWord.word));
    },
  );
}

function buildSaToSanEdits(text) {
  return collectWordEdits(
    text,
    /σα/giu,
    (source) => applyCasePattern(source, 'σαν'),
    () => true,
  );
}

function buildEllipsisEdits(text) {
  return [...text.matchAll(/\.{4,}/g)].map((match) => ({
    start: match.index,
    end: match.index + match[0].length,
    replacement: '...',
  }));
}

const applyEdits = (text, sourceMap, edits) => {
  if (!Array.isArray(edits) || edits.length === 0) {
    return {
      text,
      sourceMap,
      replacementCount: 0,
    };
  }

  let cursor = 0;
  let nextText = '';
  let nextSourceMap = [];

  edits.forEach((edit) => {
    nextText += text.slice(cursor, edit.start);
    nextSourceMap = nextSourceMap.concat(sourceMap.slice(cursor, edit.start));

    const anchor =
      sourceMap[edit.start] ??
      sourceMap[Math.max(edit.end - 1, 0)] ??
      sourceMap[sourceMap.length - 1] ??
      0;

    nextText += edit.replacement;
    nextSourceMap = nextSourceMap.concat(Array.from(edit.replacement, () => anchor));
    cursor = edit.end;
  });

  nextText += text.slice(cursor);
  nextSourceMap = nextSourceMap.concat(sourceMap.slice(cursor));

  return {
    text: nextText,
    sourceMap: nextSourceMap,
    replacementCount: edits.length,
  };
};

export const normalizeBooksEditorOptions = (editorOptions) => {
  if (!editorOptions || typeof editorOptions !== 'object' || Array.isArray(editorOptions)) {
    throw new ApiError(400, 'INVALID_EDITOR_OPTIONS', 'editorOptions must be a JSON object', {
      details: [{ field: 'editorOptions', issue: 'Expected a JSON object payload' }],
    });
  }

  if (!Array.isArray(editorOptions.ruleIds)) {
    throw new ApiError(400, 'INVALID_EDITOR_OPTIONS', 'ruleIds must be an array', {
      details: [{ field: 'editorOptions.ruleIds', issue: 'Provide an array of rule ids' }],
    });
  }

  const normalizedIds = editorOptions.ruleIds.map((ruleId, index) => {
    const normalizedRuleId = String(ruleId || '').trim();

    if (!normalizedRuleId) {
      throw new ApiError(400, 'INVALID_RULE_ID', 'ruleIds must contain non-empty ids', {
        details: [
          {
            field: `editorOptions.ruleIds[${index}]`,
            issue: 'Rule id cannot be empty',
          },
        ],
      });
    }

    if (!BOOKS_RULE_IDS.includes(normalizedRuleId)) {
      throw new ApiError(400, 'INVALID_RULE_ID', `Unsupported rule id: ${normalizedRuleId}`, {
        details: [
          {
            field: `editorOptions.ruleIds[${index}]`,
            issue: `Allowed values are ${BOOKS_RULE_IDS.join(', ')}`,
          },
        ],
      });
    }

    return normalizedRuleId;
  });

  const uniqueRuleIds = BOOKS_RULE_REGISTRY.map((rule) => rule.id).filter((ruleId) =>
    normalizedIds.includes(ruleId),
  );

  if (uniqueRuleIds.length === 0) {
    throw new ApiError(400, 'EMPTY_RULE_SELECTION', 'Select at least one correction rule', {
      details: [{ field: 'editorOptions.ruleIds', issue: 'At least one rule id is required' }],
    });
  }

  return {
    ruleIds: uniqueRuleIds,
  };
};

export const applyGreekEditorRules = (inputText, selectedRuleIds) => {
  let text = String(inputText || '');
  let sourceMap = Array.from(text, (_char, index) => index);
  const replacementCounts = {};

  BOOKS_RULE_REGISTRY.forEach((rule) => {
    if (!selectedRuleIds.includes(rule.id)) {
      return;
    }

    const edits = rule.apply(text);
    const next = applyEdits(text, sourceMap, edits);
    text = next.text;
    sourceMap = next.sourceMap;
    replacementCounts[rule.id] = next.replacementCount;
  });

  return {
    text,
    sourceMap,
    replacementCounts,
    totalReplacements: Object.values(replacementCounts).reduce((sum, count) => sum + count, 0),
  };
};
