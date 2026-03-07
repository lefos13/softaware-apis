/*
 * The Greek editor keeps one rule registry and one option normalizer so DOCX
 * rewriting, pasted-text processing, reporting, and frontend rule ids stay in
 * sync as the catalog grows.
 */
import { ApiError } from '../../common/utils/api-error.js';

const GREEK_LOCALE = 'el';
const GREEK_LETTER_REGEX = /\p{Script=Greek}/u;
const GREEK_WORD_REGEX = /[\p{Script=Greek}]+/gu;
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
const ANDRAS_STYLE_VALUES = new Set(['antras', 'andras']);
const AVGO_STYLE_VALUES = new Set(['avgo', 'avgoBeta']);
const COLLOQUIAL_ENDINGS = [
  ['άγανε', 'ούσαν'],
  ['αγανε', 'ούσαν'],
  ['άγατε', 'ούσατε'],
  ['άγαμε', 'ούσαμε'],
  ['άγαν', 'ούσαν'],
  ['αγαν', 'ούσαν'],
  ['αγες', 'ούσες'],
  ['αγα', 'ούσα'],
  ['αγε', 'ούσε'],
];
const SENTENCE_END_CHAR_REGEX = /[.!?;…\n]/;
const COLLOQUIAL_PROGRESSIVE_EXCLUDED_STEMS = ['σπ', 'σκ', 'κλ'];

const DIRECT_WORD_REPLACEMENTS = {
  och_interjection_normalize: {
    ωχ: 'οχ',
  },
  zilia_normalize: {
    ζήλεια: 'ζήλια',
  },
  ktirio_normalize: {
    κτήριο: 'κτίριο',
  },
  etaireia_normalize: {
    εταιρία: 'εταιρεία',
  },
  parempiptontos_normalize: {
    περεπιπτόντως: 'παρεμπιπτόντως',
  },
  syngnomi_normalize: {
    συγνώμη: 'συγγνώμη',
  },
  bira_normalize: {
    μπύρα: 'μπίρα',
  },
  xidi_normalize: {
    ξύδι: 'ξίδι',
  },
  parti_normalize: {
    πάρτυ: 'πάρτι',
  },
  stil_normalize: {
    στυλ: 'στιλ',
  },
  xipolytos_normalize: {
    ξυπόλητος: 'ξυπόλυτος',
  },
  chronon_normalize: {
    χρονών: 'χρόνων',
  },
  ok_uppercase: {
    οκ: 'ΟΚ',
  },
};

const DIRECT_PHRASE_REPLACEMENTS = {
  parolo_pou_normalize: {
    "παρ' όλο που": 'παρόλο που',
  },
  par_ola_auta_normalize: {
    'παρόλα αυτά': "παρ' όλα αυτά",
  },
  siga_siga_spacing: {
    'σιγά-σιγά': 'σιγά σιγά',
  },
  cheri_cheri_spacing: {
    'χέρι-χέρι': 'χέρι χέρι',
  },
};

const ANDRAS_TARGET_MAP = {
  andras: {
    άντρας: 'άνδρας',
    άντρα: 'άνδρα',
    άντρες: 'άνδρες',
    αντρών: 'ανδρών',
  },
  antras: {
    άνδρας: 'άντρας',
    άνδρα: 'άντρα',
    άνδρες: 'άντρες',
    ανδρών: 'αντρών',
  },
};

const AVGO_TARGET_MAP = {
  avgo: {
    αβγό: 'αυγό',
    αβγά: 'αυγά',
    αβγού: 'αυγού',
    αβγών: 'αυγών',
  },
  avgoBeta: {
    αυγό: 'αβγό',
    αυγά: 'αβγά',
    αυγού: 'αβγού',
    αυγών: 'αβγών',
  },
};

const ACCENT_STRIP_MAP = new Map([
  ['ά', 'α'],
  ['έ', 'ε'],
  ['ή', 'η'],
  ['ί', 'ι'],
  ['ό', 'ο'],
  ['ύ', 'υ'],
  ['ώ', 'ω'],
  ['Ά', 'Α'],
  ['Έ', 'Ε'],
  ['Ή', 'Η'],
  ['Ί', 'Ι'],
  ['Ό', 'Ο'],
  ['Ύ', 'Υ'],
  ['Ώ', 'Ω'],
]);

const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

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

const collectRegexEdits = (
  text,
  expression,
  { boundary = 'none', shouldReplace = () => true, replacementResolver },
) => {
  const edits = [];

  for (const match of text.matchAll(expression)) {
    const source = match[0];
    const start = match.index;
    const end = start + source.length;
    const hasWordBoundary = boundary !== 'word' || isStandaloneWord(text, start, end);

    if (!hasWordBoundary) {
      continue;
    }

    if (!shouldReplace(match, text, start, end, source)) {
      continue;
    }

    const replacement = replacementResolver(match, text, start, end, source);
    if (replacement !== source) {
      edits.push({ start, end, replacement });
    }
  }

  return edits;
};

const buildMappedWordEdits = (text, mapping) => {
  const keys = Object.keys(mapping || {});
  if (keys.length === 0) {
    return [];
  }

  const expression = new RegExp(
    keys
      .map(escapeRegex)
      .sort((left, right) => right.length - left.length)
      .join('|'),
    'giu',
  );
  return collectRegexEdits(text, expression, {
    boundary: 'word',
    replacementResolver: (match) => {
      const source = match[0];
      return applyCasePattern(source, mapping[source.toLocaleLowerCase(GREEK_LOCALE)] || source);
    },
  });
};

const buildMappedPhraseEdits = (text, mapping) => {
  const keys = Object.keys(mapping || {});
  if (keys.length === 0) {
    return [];
  }

  const expression = new RegExp(
    keys
      .map(escapeRegex)
      .sort((left, right) => right.length - left.length)
      .join('|'),
    'giu',
  );
  return collectRegexEdits(text, expression, {
    boundary: 'word',
    replacementResolver: (match) => {
      const source = match[0];
      return applyCasePattern(source, mapping[source.toLocaleLowerCase(GREEK_LOCALE)] || source);
    },
  });
};

const replacePrefixWithCase = (source, fromPrefix, toPrefix) => {
  return `${applyCasePattern(source.slice(0, fromPrefix.length), toPrefix)}${source.slice(fromPrefix.length)}`;
};

const stripLastGreekAccent = (value) => {
  const chars = Array.from(value);

  for (let index = chars.length - 1; index >= 0; index -= 1) {
    const plain = ACCENT_STRIP_MAP.get(chars[index]);
    if (plain) {
      chars[index] = plain;
      break;
    }
  }

  return chars.join('');
};

const normalizeGreekText = (value) =>
  Array.from(String(value || ''))
    .map((char) => ACCENT_STRIP_MAP.get(char) || char)
    .join('')
    .toLocaleLowerCase(GREEK_LOCALE);

const resolveSentenceBounds = (text, start, end) => {
  let sentenceStart = start;
  let sentenceEnd = end;

  while (sentenceStart > 0 && !SENTENCE_END_CHAR_REGEX.test(text[sentenceStart - 1])) {
    sentenceStart -= 1;
  }

  while (sentenceEnd < text.length && !SENTENCE_END_CHAR_REGEX.test(text[sentenceEnd])) {
    sentenceEnd += 1;
  }

  if (sentenceEnd < text.length) {
    sentenceEnd += 1;
  }

  return { sentenceStart, sentenceEnd };
};

const buildPrefixFamilyEdits = (text, prefixPairs) => {
  const expression = GREEK_WORD_REGEX;

  return collectRegexEdits(text, expression, {
    boundary: 'word',
    shouldReplace: (match) => {
      const normalized = match[0].toLocaleLowerCase(GREEK_LOCALE);
      return prefixPairs.some(([prefix]) => normalized.startsWith(prefix));
    },
    replacementResolver: (match) => {
      const source = match[0];
      const normalized = source.toLocaleLowerCase(GREEK_LOCALE);
      const pair = prefixPairs.find(([prefix]) => normalized.startsWith(prefix));

      if (!pair) {
        return source;
      }

      const [fromPrefix, toPrefix] = pair;
      return replacePrefixWithCase(source, fromPrefix, toPrefix);
    },
  });
};

const buildPreview = (text, start, end, replacement) => {
  const prefix = text.slice(Math.max(0, start - 24), start);
  const suffix = text.slice(end, Math.min(text.length, end + 24));
  const before = text.slice(start, end);

  return {
    before: `${prefix}[${before}]${suffix}`,
    after: `${prefix}[${replacement}]${suffix}`,
  };
};

const applyEdits = (text, sourceMap, edits, ruleId, context = {}) => {
  if (!Array.isArray(edits) || edits.length === 0) {
    return {
      text,
      sourceMap,
      replacementCount: 0,
      changes: [],
    };
  }

  let cursor = 0;
  let nextText = '';
  let nextSourceMap = [];
  const changes = [];

  edits.forEach((edit) => {
    nextText += text.slice(cursor, edit.start);
    nextSourceMap = nextSourceMap.concat(sourceMap.slice(cursor, edit.start));

    const anchor =
      sourceMap[edit.start] ??
      sourceMap[Math.max(edit.end - 1, 0)] ??
      sourceMap[sourceMap.length - 1] ??
      0;
    const preview = buildPreview(text, edit.start, edit.end, edit.replacement);
    const { sentenceStart, sentenceEnd } = resolveSentenceBounds(text, edit.start, edit.end);
    const sentenceBefore = text.slice(sentenceStart, sentenceEnd).trim();
    const sentenceAfter = `${text.slice(sentenceStart, edit.start)}${edit.replacement}${text.slice(
      edit.end,
      sentenceEnd,
    )}`.trim();

    changes.push({
      ruleId,
      before: text.slice(edit.start, edit.end),
      after: edit.replacement,
      position: edit.start,
      previewBefore: preview.before,
      previewAfter: preview.after,
      sentenceBefore,
      sentenceAfter,
      ...context,
    });

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
    changes,
  };
};

function buildKaiBeforeVowelEdits(text) {
  return collectRegexEdits(text, /και/giu, {
    boundary: 'word',
    replacementResolver: (match) => applyCasePattern(match[0], 'κι'),
    shouldReplace: (_match, value, _start, end) => {
      const nextWord = resolveNextGreekWord(value, end);
      return Boolean(nextWord?.word && GREEK_VOWEL_REGEX.test(nextWord.word[0]));
    },
  });
}

function buildStinArticleTrimEdits(text) {
  return collectRegexEdits(text, /στην|την/giu, {
    boundary: 'word',
    replacementResolver: (match) =>
      applyCasePattern(
        match[0],
        match[0].toLocaleLowerCase(GREEK_LOCALE) === 'στην' ? 'στη' : 'τη',
      ),
    shouldReplace: (_match, value, _start, end) => {
      const nextWord = resolveNextGreekWord(value, end);
      return Boolean(nextWord?.word && canTrimForNextWord(nextWord.word));
    },
  });
}

function buildMinNegationTrimEdits(text) {
  return collectRegexEdits(text, /μην/giu, {
    boundary: 'word',
    replacementResolver: (match) => applyCasePattern(match[0], 'μη'),
    shouldReplace: (_match, value, _start, end) => {
      const nextWord = resolveNextGreekWord(value, end);
      return Boolean(nextWord?.word && canTrimForNextWord(nextWord.word));
    },
  });
}

function buildSaToSanEdits(text) {
  return collectRegexEdits(text, /σα/giu, {
    boundary: 'word',
    replacementResolver: (match) => applyCasePattern(match[0], 'σαν'),
  });
}

function buildEllipsisEdits(text) {
  return [...text.matchAll(/\.{4,}/g)].map((match) => ({
    start: match.index,
    end: match.index + match[0].length,
    replacement: '...',
  }));
}

function buildMultipleSpacesEdits(text) {
  return [...text.matchAll(/[^\S\r\n]{2,}/g)].map((match) => ({
    start: match.index,
    end: match.index + match[0].length,
    replacement: ' ',
  }));
}

function buildGuillemetsEdits(text) {
  return [...text.matchAll(/<<|>>/g)].map((match) => ({
    start: match.index,
    end: match.index + match[0].length,
    replacement: match[0] === '<<' ? '«' : '»',
  }));
}

function buildDenNegationTrimEdits(text) {
  return collectRegexEdits(text, /δεν/giu, {
    boundary: 'word',
    replacementResolver: (match) => applyCasePattern(match[0], 'δε'),
    shouldReplace: (_match, value, _start, end) => {
      const nextWord = resolveNextGreekWord(value, end);
      return Boolean(nextWord?.word && canTrimForNextWord(nextWord.word));
    },
  });
}

function buildAkomaBeforeKaiEdits(text) {
  return collectRegexEdits(text, /(ακόμη)(\s+)(και|κι)/giu, {
    boundary: 'word',
    replacementResolver: (match) => `${applyCasePattern(match[1], 'ακόμα')}${match[2]}${match[3]}`,
  });
}

function buildPrinNaToProtouEdits(text) {
  return collectRegexEdits(text, /(πριν)(\s+)(να)/giu, {
    boundary: 'word',
    replacementResolver: (match) => applyCasePattern(match[0], 'προτού'),
  });
}

function buildMeSeMenaSenaEdits(text) {
  const targets = {
    'με μένα': "μ' εμένα",
    'με σένα': "μ' εσένα",
    'σε μένα': "σ' εμένα",
    'σε σένα': "σ' εσένα",
  };

  return collectRegexEdits(text, /(με|σε)(\s+)(μένα|σένα)/giu, {
    boundary: 'word',
    replacementResolver: (match) => {
      const normalized = `${match[1].toLocaleLowerCase(GREEK_LOCALE)} ${match[3].toLocaleLowerCase(GREEK_LOCALE)}`;
      return applyCasePattern(match[0], targets[normalized] || match[0]);
    },
  });
}

function buildVromiaFamilyEdits(text) {
  return buildPrefixFamilyEdits(text, [
    ['βρωμ', 'βρομ'],
    ['βρώμ', 'βρόμ'],
  ]);
}

function buildAntikrizoFamilyEdits(text) {
  return buildPrefixFamilyEdits(text, [
    ['αντικρυ', 'αντικρι'],
    ['αντικρύ', 'αντικρί'],
  ]);
}

function buildKlotsoFamilyEdits(text) {
  return buildPrefixFamilyEdits(text, [
    ['κλωτσ', 'κλοτσ'],
    ['κλώτσ', 'κλότσ'],
  ]);
}

function buildAndrasPreferenceEdits(text, options) {
  return buildMappedWordEdits(text, ANDRAS_TARGET_MAP[options.preferences.andrasStyle]);
}

function buildAvgoPreferenceEdits(text, options) {
  return buildMappedWordEdits(text, AVGO_TARGET_MAP[options.preferences.avgoStyle]);
}

function buildColloquialPastProgressiveEdits(text) {
  return collectRegexEdits(text, GREEK_WORD_REGEX, {
    boundary: 'word',
    shouldReplace: (match) => {
      const normalized = match[0].toLocaleLowerCase(GREEK_LOCALE);
      return COLLOQUIAL_ENDINGS.some(([ending]) => {
        if (!normalized.endsWith(ending) || normalized.length <= ending.length + 2) {
          return false;
        }

        const stem = normalizeGreekText(match[0].slice(0, match[0].length - ending.length));
        return !COLLOQUIAL_PROGRESSIVE_EXCLUDED_STEMS.some((excludedStem) =>
          stem.endsWith(excludedStem),
        );
      });
    },
    replacementResolver: (match) => {
      const source = match[0];
      const normalized = source.toLocaleLowerCase(GREEK_LOCALE);
      const pair = COLLOQUIAL_ENDINGS.find(
        ([ending]) => normalized.endsWith(ending) && normalized.length > ending.length + 2,
      );

      if (!pair) {
        return source;
      }

      const [ending, replacementEnding] = pair;
      const stem = source.slice(0, source.length - ending.length);
      return `${stripLastGreekAccent(stem)}${applyCasePattern(
        source.slice(source.length - ending.length),
        replacementEnding,
      )}`;
    },
  });
}

function buildOkUppercaseEdits(text) {
  return collectRegexEdits(text, /οκ/giu, {
    boundary: 'word',
    replacementResolver: () => 'ΟΚ',
  });
}

export const BOOKS_RULE_REGISTRY = [
  { id: 'kai_before_vowel', apply: buildKaiBeforeVowelEdits },
  { id: 'stin_article_trim', apply: buildStinArticleTrimEdits },
  { id: 'min_negation_trim', apply: buildMinNegationTrimEdits },
  { id: 'sa_to_san', apply: buildSaToSanEdits },
  { id: 'ellipsis_normalize', apply: buildEllipsisEdits },
  { id: 'multiple_spaces_normalize', apply: buildMultipleSpacesEdits },
  { id: 'guillemets_normalize', apply: buildGuillemetsEdits },
  { id: 'den_negation_trim', apply: buildDenNegationTrimEdits },
  { id: 'akomi_to_akoma_before_kai', apply: buildAkomaBeforeKaiEdits },
  { id: 'prin_na_to_protou', apply: buildPrinNaToProtouEdits },
  { id: 'me_se_mena_sena_contract', apply: buildMeSeMenaSenaEdits },
  { id: 'vromia_family_omicron', apply: buildVromiaFamilyEdits },
  { id: 'antikrizo_family_iota', apply: buildAntikrizoFamilyEdits },
  { id: 'klotso_family_omicron', apply: buildKlotsoFamilyEdits },
  { id: 'andras_preference', apply: buildAndrasPreferenceEdits },
  {
    id: 'och_interjection_normalize',
    apply: (text) =>
      buildMappedWordEdits(text, DIRECT_WORD_REPLACEMENTS.och_interjection_normalize),
  },
  {
    id: 'zilia_normalize',
    apply: (text) => buildMappedWordEdits(text, DIRECT_WORD_REPLACEMENTS.zilia_normalize),
  },
  {
    id: 'ktirio_normalize',
    apply: (text) => buildMappedWordEdits(text, DIRECT_WORD_REPLACEMENTS.ktirio_normalize),
  },
  {
    id: 'etaireia_normalize',
    apply: (text) => buildMappedWordEdits(text, DIRECT_WORD_REPLACEMENTS.etaireia_normalize),
  },
  {
    id: 'parolo_pou_normalize',
    apply: (text) => buildMappedPhraseEdits(text, DIRECT_PHRASE_REPLACEMENTS.parolo_pou_normalize),
  },
  {
    id: 'par_ola_auta_normalize',
    apply: (text) =>
      buildMappedPhraseEdits(text, DIRECT_PHRASE_REPLACEMENTS.par_ola_auta_normalize),
  },
  {
    id: 'parempiptontos_normalize',
    apply: (text) => buildMappedWordEdits(text, DIRECT_WORD_REPLACEMENTS.parempiptontos_normalize),
  },
  {
    id: 'syngnomi_normalize',
    apply: (text) => buildMappedWordEdits(text, DIRECT_WORD_REPLACEMENTS.syngnomi_normalize),
  },
  {
    id: 'bira_normalize',
    apply: (text) => buildMappedWordEdits(text, DIRECT_WORD_REPLACEMENTS.bira_normalize),
  },
  {
    id: 'xidi_normalize',
    apply: (text) => buildMappedWordEdits(text, DIRECT_WORD_REPLACEMENTS.xidi_normalize),
  },
  { id: 'avgo_preference', apply: buildAvgoPreferenceEdits },
  {
    id: 'parti_normalize',
    apply: (text) => buildMappedWordEdits(text, DIRECT_WORD_REPLACEMENTS.parti_normalize),
  },
  {
    id: 'stil_normalize',
    apply: (text) => buildMappedWordEdits(text, DIRECT_WORD_REPLACEMENTS.stil_normalize),
  },
  {
    id: 'xipolytos_normalize',
    apply: (text) => buildMappedWordEdits(text, DIRECT_WORD_REPLACEMENTS.xipolytos_normalize),
  },
  {
    id: 'chronon_normalize',
    apply: (text) => buildMappedWordEdits(text, DIRECT_WORD_REPLACEMENTS.chronon_normalize),
  },
  { id: 'colloquial_past_progressive_normalize', apply: buildColloquialPastProgressiveEdits },
  {
    id: 'ok_uppercase',
    apply: buildOkUppercaseEdits,
  },
  {
    id: 'siga_siga_spacing',
    apply: (text) => buildMappedPhraseEdits(text, DIRECT_PHRASE_REPLACEMENTS.siga_siga_spacing),
  },
  {
    id: 'cheri_cheri_spacing',
    apply: (text) => buildMappedPhraseEdits(text, DIRECT_PHRASE_REPLACEMENTS.cheri_cheri_spacing),
  },
];

export const BOOKS_RULE_IDS = BOOKS_RULE_REGISTRY.map((rule) => rule.id);

/*
 * Preference-based rules keep stable backend ids, but their target form comes
 * from editorOptions so the same checkbox can support mutually exclusive forms.
 */
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

  const rawPreferences =
    editorOptions.preferences &&
    typeof editorOptions.preferences === 'object' &&
    !Array.isArray(editorOptions.preferences)
      ? editorOptions.preferences
      : {};
  const andrasStyle = String(rawPreferences.andrasStyle || 'antras').trim();
  const avgoStyle = String(rawPreferences.avgoStyle || 'avgo').trim();

  if (!ANDRAS_STYLE_VALUES.has(andrasStyle)) {
    throw new ApiError(400, 'INVALID_RULE_PREFERENCE', 'Unsupported andrasStyle preference', {
      details: [
        {
          field: 'editorOptions.preferences.andrasStyle',
          issue: 'Allowed values are antras, andras',
        },
      ],
    });
  }

  if (!AVGO_STYLE_VALUES.has(avgoStyle)) {
    throw new ApiError(400, 'INVALID_RULE_PREFERENCE', 'Unsupported avgoStyle preference', {
      details: [
        {
          field: 'editorOptions.preferences.avgoStyle',
          issue: 'Allowed values are avgo, avgoBeta',
        },
      ],
    });
  }

  return {
    ruleIds: uniqueRuleIds,
    includeReport: editorOptions.includeReport === true,
    preferences: {
      andrasStyle,
      avgoStyle,
    },
    normalized: true,
  };
};

export const applyGreekEditorRules = (inputText, rawEditorOptions, context = {}) => {
  const options =
    rawEditorOptions?.normalized === true
      ? rawEditorOptions
      : normalizeBooksEditorOptions(rawEditorOptions);
  let text = String(inputText || '');
  let sourceMap = Array.from(text, (_char, index) => index);
  const replacementCounts = {};
  const changes = [];

  BOOKS_RULE_REGISTRY.forEach((rule) => {
    if (!options.ruleIds.includes(rule.id)) {
      return;
    }

    const edits = rule.apply(text, options, context);
    const next = applyEdits(text, sourceMap, edits, rule.id, context);
    text = next.text;
    sourceMap = next.sourceMap;
    replacementCounts[rule.id] = next.replacementCount;
    changes.push(...next.changes);
  });

  return {
    text,
    sourceMap,
    replacementCounts,
    totalReplacements: Object.values(replacementCounts).reduce((sum, count) => sum + count, 0),
    changes,
    editorOptions: options,
  };
};
