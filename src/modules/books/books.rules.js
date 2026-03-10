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
const GENITIVE_ARTICLES = new Set(['της', 'του', 'των']);
const SAFE_PREPOSITION_BOUNDARY_CHARS = new Set([',', ':', '-', '–', '—', '(', '[', '{']);
const TRIMMING_CONSONANTS = new Set(['β', 'γ', 'δ', 'ζ', 'θ', 'λ', 'μ', 'ν', 'ρ', 'σ', 'φ', 'χ']);
const ANDRAS_STYLE_VALUES = new Set(['antras', 'andras']);
const AVGO_STYLE_VALUES = new Set(['avgo', 'avgoBeta']);
const EPTA_STYLE_VALUES = new Set(['epta', 'efta']);
const OKTO_STYLE_VALUES = new Set(['okto', 'oxto']);
const ENNIA_STYLE_VALUES = new Set(['ennia', 'ennea']);
const DEN_NEGATION_STYLE_VALUES = new Set(['contextual', 'alwaysDen']);
const QUOTE_PERIOD_STYLE_VALUES = new Set(['inside', 'outside']);
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
const COLLOQUIAL_PROGRESSIVE_EXCLUDED_STEMS = ['σπ', 'σκ'];
const COLLOQUIAL_PROGRESSIVE_EXCLUDED_WORD_STEMS = new Set(['διεξηγ', 'παρηγ', 'αχορτ', 'απηγ']);
const COMMA_SUBORDINATORS = ['για να'];
const PRIN_BEFORE_FIXED_PHRASES = [
  ['το', 'μαθημα'],
  ['τη', 'δουλεια'],
  ['το', 'ταξιδι'],
  ['το', 'πρωινο'],
  ['το', 'μεσημεριανο'],
  ['το', 'βραδινο'],
  ['το', 'φθινοπωρο'],
  ['την', 'ανοιξη'],
  ['το', 'καλοκαιρι'],
  ['τον', 'χειμωνα'],
  ['το', 'φαγητο'],
  ['τα', 'μεσανυχτα'],
  ['πολυ', 'καιρο'],
  ['λιγο', 'καιρο'],
  ['λιγο'],
];
const PRIN_BEFORE_DURATION_UNITS = new Set([
  'ωρα',
  'ωρες',
  'ωρων',
  'εβδομαδα',
  'εβδομαδες',
  'εβδομαδων',
  'χρονο',
  'χρονια',
  'χρονων',
  'μηνα',
  'μηνες',
  'μηνων',
  'μερα',
  'μερες',
  'μερων',
  'δεκαετια',
  'δεκαετιες',
  'δεκαετιων',
  'αιωνα',
  'αιωνες',
  'αιωνων',
]);
const PRIN_BEFORE_CLOCK_PERIODS = new Set(['βραδυ', 'πρωι', 'μεσημερι', 'απογευμα', 'νυχτα']);
const PRIN_BEFORE_BARE_DURATION_UNITS = new Set(['χρονια', 'χρονων', 'μερες', 'μερων']);
const QUESTION_POU_POS_DISALLOWED_OPENERS = new Set(['να']);
const QUESTION_POU_POS_EARLY_SUBORDINATORS = new Set([
  'που',
  'πως',
  'οταν',
  'αν',
  'αφου',
  'επειδη',
  'μηπως',
]);
const PRIN_BEFORE_QUANTITY_TOKENS = new Set([
  'μια',
  'μιας',
  'ενας',
  'εναν',
  'ενα',
  'δυο',
  'δυο',
  'τρεις',
  'τεσσερις',
  'πεντε',
  'εξι',
  'επτα',
  'οχτω',
  'εννια',
  'δεκα',
  'εντεκα',
  'δωδεκα',
  'δεκατρια',
  'δεκατεσσερα',
  'δεκαπεντε',
  'δεκαεξι',
  'δεκαεπτα',
  'δεκαοχτω',
  'δεκαεννια',
  'εικοσι',
  'τριαντα',
  'σαραντα',
  'πενηντα',
  'εξηντα',
  'εβδομηντα',
  'ογδοντα',
  'ενενηντα',
  'εκατο',
  'εκατον',
  'κατι',
  'μερικα',
  'μερικα',
  'μερικες',
  'μερικους',
  'πολυ',
  'πολλα',
  'πολλες',
  'πολλους',
  'λιγο',
  'λιγα',
  'λιγες',
  'λιγους',
  'αρκετο',
  'αρκετα',
  'αρκετες',
  'αρκετους',
  'καμποσο',
  'καμποσα',
  'καμποσες',
  'καμποσους',
  'σχεδον',
  'περιπου',
  'μισο',
  'μιση',
  'μισους',
  'μισους',
  'πολλαπλα',
]);
const NOBILITY_TITLES = new Map([
  ['λόρδος', 'λόρδος'],
  ['λαίδη', 'λαίδη'],
  ['πρίγκιπας', 'πρίγκιπας'],
  ['πριγκίπισσα', 'πριγκίπισσα'],
  ['βασιλιάς', 'βασιλιάς'],
  ['βασίλισσα', 'βασίλισσα'],
  ['δούκας', 'δούκας'],
  ['δούκισσα', 'δούκισσα'],
  ['βαρόνος', 'βαρόνος'],
  ['βαρόνη', 'βαρόνη'],
  ['υποκόμης', 'υποκόμης'],
  ['υποκόμισσα', 'υποκόμισσα'],
  ['μαρκήσιος', 'μαρκήσιος'],
  ['μαρκησία', 'μαρκησία'],
]);

const DIRECT_WORD_REPLACEMENTS = {
  fos_normalize: {
    φώς: 'φως',
  },
  apo_tonos_normalize: {
    απο: 'από',
  },
  och_interjection_normalize: {
    ωχ: 'οχ',
  },
  mpas_normalize: {
    μπάς: 'μπας',
  },
  nai_tonos_normalize: {
    ναί: 'ναι',
  },
  thes_tonos_normalize: {
    θές: 'θες',
  },
  op_interjection_normalize: {
    ωπ: 'οπ',
  },
  geia_tonos_normalize: {
    γειά: 'γεια',
  },
  mov_normalize: {
    μωβ: 'μοβ',
    μώβ: 'μοβ',
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
  sintrivani_normalize: {
    συντριβάνι: 'σιντριβάνι',
  },
  zaploutos_normalize: {
    ζάμπλουτος: 'ζάπλουτος',
  },
  synonthylevma_normalize: {
    συνοθύλευμα: 'συνονθύλευμα',
  },
  myes_normalize: {
    'τους μύες': 'τους μυς',
    'οι μυς': 'οι μύες',
  },
  en_telei_normalize: {
    'εν τέλη': 'εντέλει',
  },
  en_merei_normalize: {
    'εν μέρη': 'εν μέρει',
  },
  ok_uppercase: {
    οκ: 'ΟΚ',
  },
  pou_kai_pou_toning: {
    'που και που': 'πού και πού',
    'πως και πως': 'πώς και πώς',
  },
  haha_spacing_normalize: {
    χαχα: 'χα, χα',
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
  theos_phrases_normalize: {
    'δόξα τον θεό': 'δόξα τω θεώ',
    'δόξα τον Θεό': 'δόξα τω Θεώ',
    'μα τω θεώ': 'μα τον θεό',
    'μα τω Θεώ': 'μα τον Θεό',
  },
  mesa_sto_contract: {
    'μέσα στο': 'μες στο',
    'μέσα στην': 'μες στην',
    'μέσα στον': 'μες στον',
  },
  kathe_enas_series: {
    'κάθε ένας': 'καθένας',
    'κάθε μία': 'καθεμία',
    'κάθε ένα': 'καθένα',
    'κάθε έναν': 'καθέναν',
    'κάθε τι': 'καθετί',
  },
  me_mias_normalize: {
    'με μιας': 'μεμιάς',
  },
  ex_archis_normalize: {
    'εξ αρχής': 'εξαρχής',
  },
  fixed_hyphenated_phrases_normalize: {
    'πρωί βράδυ': 'πρωί-βράδυ',
    'μέρα νύχτα': 'μέρα-νύχτα',
    'άψε σβήσε': 'άψε-σβήσε',
    'πέρα δώθε': 'πέρα-δώθε',
  },
  /*
   * This keeps one canonical contracted form for the phrase so spacing and
   * apostrophe variants are normalized consistently across inputs.
   */
  giati_giati_normalize: {
    'για αυτό': 'γι’ αυτό',
    'γι αυτό': 'γι’ αυτό',
    "γι' αυτό": 'γι’ αυτό',
  },
  oson_afora_normalize: {
    'όσο αναφορά': 'όσον αφορά',
  },
  ap_oti_normalize: {
    "απ' ότι": "απ' ό,τι",
  },
  ypopsi_normalize: {
    υπόψιν: 'υπόψη',
    "υπ' όψιν": 'υπόψη',
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

const EPTA_TARGET_MAP = {
  epta: {
    εφτά: 'επτά',
  },
  efta: {
    επτά: 'εφτά',
  },
};

const OKTO_TARGET_MAP = {
  okto: {
    οχτώ: 'οκτώ',
  },
  oxto: {
    οκτώ: 'οχτώ',
  },
};

const ENNIA_TARGET_MAP = {
  ennia: {
    εννέα: 'εννιά',
  },
  ennea: {
    εννιά: 'εννέα',
  },
};

/*
 * Accent and style normalization now mixes exact-token replacements with
 * family-aware verb handling so the editor can support both preference-based
 * spelling choices and frequent monotonic Greek fixes without duplicating logic
 * in separate DOCX and text flows.
 */
const POIOS_TONOS_MAP = {
  ποιό: 'ποιο',
  ποιός: 'ποιος',
  ποιά: 'ποια',
  ποιού: 'ποιου',
  ποιάς: 'ποιας',
};

const PIO_TONOS_MAP = {
  πιώ: 'πιω',
  πιείς: 'πιεις',
  πιεί: 'πιει',
  πιούν: 'πιουν',
};

const GIOS_TONOS_MAP = {
  γιός: 'γιος',
  γιό: 'γιο',
  γιοί: 'γιοι',
  γιών: 'γιων',
};

const DEI_TONOS_MAP = {
  δεί: 'δει',
  δείς: 'δεις',
  δούν: 'δουν',
};

const XTES_MAP = {
  χθές: 'χτες',
  χτές: 'χτες',
  προχθές: 'προχτές',
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

const resolvePreviousGreekWord = (text, endIndex) => {
  let cursor = endIndex - 1;

  while (cursor >= 0 && /\s/u.test(text[cursor])) {
    cursor -= 1;
  }

  if (cursor < 0 || !isGreekLetter(text[cursor])) {
    return null;
  }

  let start = cursor;
  while (start >= 0 && isGreekLetter(text[start])) {
    start -= 1;
  }

  return {
    start: start + 1,
    end: cursor + 1,
    word: text.slice(start + 1, cursor + 1),
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

const shouldUseAutiTin = (word) => {
  const normalized = normalizeGreekText(word);
  const first = normalized[0] || '';
  const second = normalized[1] || '';

  if (GREEK_VOWEL_REGEX.test(word[0] || '')) {
    return true;
  }

  if (first === 'γ' && second === 'κ') {
    return true;
  }

  if (first === 'μ' && second === 'π') {
    return true;
  }

  if (first === 'ν' && second === 'τ') {
    return true;
  }

  return first === 'ξ' || first === 'ψ';
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

const isSentenceStart = (text, index) => {
  let cursor = index - 1;

  while (cursor >= 0) {
    const char = text[cursor];
    if (
      char === ' ' ||
      char === '\t' ||
      char === '\n' ||
      char === '\r' ||
      char === '"' ||
      char === "'" ||
      char === '«' ||
      char === '“' ||
      char === '‘' ||
      char === '(' ||
      char === '[' ||
      char === '{'
    ) {
      cursor -= 1;
      continue;
    }

    return SENTENCE_END_CHAR_REGEX.test(char);
  }

  return true;
};

const readFollowingGreekLikeTokens = (text, startIndex, maxTokens = 6) => {
  const tokens = [];
  let cursor = startIndex;

  while (cursor < text.length && tokens.length < maxTokens) {
    while (cursor < text.length && /\s/u.test(text[cursor])) {
      cursor += 1;
    }

    if (cursor >= text.length || /[.,!?;:…·]/u.test(text[cursor])) {
      break;
    }

    const firstChar = text[cursor];
    if (!isGreekLetter(firstChar) && !/\d/u.test(firstChar)) {
      break;
    }

    let end = cursor + 1;
    while (end < text.length && (isGreekLetter(text[end]) || /\d/u.test(text[end]))) {
      end += 1;
    }

    const raw = text.slice(cursor, end);
    tokens.push({
      raw,
      normalized: normalizeGreekText(raw),
    });
    cursor = end;
  }

  return tokens;
};

/*
 * These helpers keep the new "λόγω" and "βάσει" rules tied to the narrow
 * genitive patterns that behave like inserted prepositional phrases instead of
 * broad noun matching, so common nominal uses of "λόγος" and "βάση" stay safe.
 */
const isGreekToken = (token) => Boolean(token?.raw && isGreekLetter(token.raw[0]));

const startsWithGenitiveArticlePhrase = (tokens) =>
  GENITIVE_ARTICLES.has(tokens[0]?.normalized || '') && isGreekToken(tokens[1]);

const hasSafePrepositionBoundary = (text, start) => {
  if (isSentenceStart(text, start)) {
    return true;
  }

  let cursor = start - 1;
  while (cursor >= 0 && /\s/u.test(text[cursor])) {
    cursor -= 1;
  }

  if (cursor < 0) {
    return true;
  }

  return SAFE_PREPOSITION_BOUNDARY_CHARS.has(text[cursor]);
};

const isAnMiTiAlloPhrase = (text, start, end) => {
  const previousWord = resolvePreviousGreekWord(text, start);
  const tokens = readFollowingGreekLikeTokens(text, end, 3);

  return (
    normalizeGreekText(previousWord?.word || '') === 'αν' &&
    tokens[0]?.normalized === 'τι' &&
    tokens[1]?.normalized === 'αλλο'
  );
};

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
  const autiPhraseEdits = collectRegexEdits(text, /(αυτή|αυτήν)(\s+)(την|τη)/giu, {
    boundary: 'word',
    shouldReplace: (_match, value, _start, end) => {
      const nextWord = resolveNextGreekWord(value, end);
      return Boolean(nextWord?.word);
    },
    replacementResolver: (match, value, _start, end) => {
      const nextWord = resolveNextGreekWord(value, end);
      const shouldUseTin = shouldUseAutiTin(nextWord?.word || '');
      const demonstrative = applyCasePattern(match[1], shouldUseTin ? 'αυτή' : 'αυτήν');
      const article = applyCasePattern(match[3], shouldUseTin ? 'την' : 'τη');
      return `${demonstrative}${match[2]}${article}`;
    },
  });

  const standaloneEdits = collectRegexEdits(text, /στην|την/giu, {
    boundary: 'word',
    replacementResolver: (match) =>
      applyCasePattern(
        match[0],
        match[0].toLocaleLowerCase(GREEK_LOCALE) === 'στην' ? 'στη' : 'τη',
      ),
    shouldReplace: (_match, value, start, end) => {
      const previousWord = resolvePreviousGreekWord(value, start);
      if (previousWord) {
        const normalizedPrevious = normalizeGreekText(previousWord.word);
        if (normalizedPrevious === 'αυτη' || normalizedPrevious === 'αυτην') {
          return false;
        }
      }

      const nextWord = resolveNextGreekWord(value, end);
      return Boolean(nextWord?.word && canTrimForNextWord(nextWord.word));
    },
  });

  return [...autiPhraseEdits, ...standaloneEdits].sort((left, right) => left.start - right.start);
}

const shouldUseMinForm = (word) => {
  const normalized = normalizeGreekText(word);
  const first = normalized[0] || '';
  const second = normalized[1] || '';

  if (GREEK_VOWEL_REGEX.test(word[0] || '')) {
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

  return !['κ', 'π', 'τ', 'ξ', 'ψ'].includes(first);
};

function buildMinNegationTrimEdits(text) {
  return collectRegexEdits(text, /μην|μη/giu, {
    boundary: 'word',
    replacementResolver: (match, value, start, end) => {
      const nextWord = resolveNextGreekWord(value, end);
      if (!nextWord?.word) {
        return match[0];
      }

      if (isAnMiTiAlloPhrase(value, start, end)) {
        return applyCasePattern(match[0], 'μη');
      }

      if (
        normalizeGreekText(match[0]) === 'μη' &&
        normalizeGreekText(nextWord.word) === 'αλκοολουχα'
      ) {
        return match[0];
      }

      return applyCasePattern(match[0], shouldUseMinForm(nextWord.word) ? 'μη' : 'μην');
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

/*
 * These spacing fixes only add missing spaces after commas and sentence-ending
 * periods. They skip already valid whitespace, the fixed "ό,τι" form, decimal
 * numbers, and the closing-guillemet exception the editor uses for Greek
 * dialogue punctuation.
 */
function buildCommaSpaceEdits(text) {
  return [...text.matchAll(/,(?!\s|$|\u00BB)/g)].flatMap((match) => {
    const previousChar = text[Math.max(match.index - 1, 0)] || '';
    const nextChunk = text.slice(Math.max(match.index - 1, 0), match.index + 3);

    if (normalizeGreekText(nextChunk) === 'ο,τι' && normalizeGreekText(previousChar) === 'ο') {
      return [];
    }

    return [
      {
        start: match.index,
        end: match.index + match[0].length,
        replacement: ', ',
      },
    ];
  });
}

function buildPeriodSpaceEdits(text) {
  /*
   * Skip periods that are part of consecutive dots so ellipsis-like punctuation
   * is not split by this spacing rule.
   */
  return [...text.matchAll(/\.(?!\s|$|»|\d|\.)/g)].flatMap((match) => {
    const previousChar = text[Math.max(match.index - 1, 0)] || '';
    if (/\d/u.test(previousChar)) {
      return [];
    }

    return [
      {
        start: match.index,
        end: match.index + match[0].length,
        replacement: '. ',
      },
    ];
  });
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

/*
 * The negation rule now supports either contextual trimming or global "δεν"
 * normalization so one checkbox can serve both editorial house-style choices.
 */
function buildDenNegationPreferenceEdits(text, options) {
  if (options.preferences.denNegationStyle === 'alwaysDen') {
    return collectRegexEdits(text, /δε(ν)?/giu, {
      boundary: 'word',
      replacementResolver: (match) => applyCasePattern(match[0], 'δεν'),
    });
  }

  return buildDenNegationTrimEdits(text);
}

function buildAkomaBeforeKaiEdits(text) {
  return collectRegexEdits(text, /(ακόμη)(\s+)(και|κι)/giu, {
    boundary: 'word',
    replacementResolver: (match) => `${applyCasePattern(match[1], 'ακόμα')}${match[2]}${match[3]}`,
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

function buildTheosPhraseEdits(text) {
  return collectRegexEdits(text, /δόξα τον θεό|μα τω θεώ/giu, {
    boundary: 'word',
    replacementResolver: (match) => {
      const source = match[0];
      const normalized = source.toLocaleLowerCase(GREEK_LOCALE);
      const baseReplacement = normalized === 'δόξα τον θεό' ? 'δόξα τω θεώ' : 'μα τον θεό';
      const casedReplacement = applyCasePattern(source, baseReplacement);

      if (source.includes('Θ')) {
        return casedReplacement.replace('θεώ', 'Θεώ').replace('θεό', 'Θεό');
      }

      return casedReplacement;
    },
  });
}

/*
 * These builders cover phrase-sensitive editorial rules that depend on nearby
 * words, punctuation, or user-selected punctuation preferences instead of
 * simple one-word substitutions.
 */
function buildPrinBeforeTimePhraseEdits(text) {
  const startsWithPattern = (tokens, pattern) =>
    pattern.every((part, index) => tokens[index]?.normalized === part);
  const isQuantityToken = (token) =>
    Boolean(token) &&
    (/^\d+$/u.test(token.normalized) || PRIN_BEFORE_QUANTITY_TOKENS.has(token.normalized));
  const isClockTimePhrase = (tokens) =>
    tokens[0]?.normalized === 'τις' &&
    isQuantityToken(tokens[1]) &&
    (!tokens[2] ||
      (tokens[2].normalized === 'το' && PRIN_BEFORE_CLOCK_PERIODS.has(tokens[3]?.normalized)));
  const isDurationPhrase = (tokens) => {
    const unitIndex = tokens.findIndex(
      (token, index) => index < 5 && PRIN_BEFORE_DURATION_UNITS.has(token.normalized),
    );
    if (unitIndex <= 0) {
      return false;
    }

    return tokens.slice(0, unitIndex).every(isQuantityToken);
  };
  const isBareDurationPhrase = (tokens) =>
    PRIN_BEFORE_BARE_DURATION_UNITS.has(tokens[0]?.normalized);

  return collectRegexEdits(text, /πριν/giu, {
    boundary: 'word',
    shouldReplace: (_match, value, _start, end) => {
      const tokens = readFollowingGreekLikeTokens(value, end, 6);
      return (
        PRIN_BEFORE_FIXED_PHRASES.some((pattern) => startsWithPattern(tokens, pattern)) ||
        isDurationPhrase(tokens) ||
        isBareDurationPhrase(tokens) ||
        isClockTimePhrase(tokens)
      );
    },
    replacementResolver: (match) => `${match[0]} από`,
  });
}

function buildQuestionPouPosToningEdits(text) {
  const edits = [];
  const expression = /που|πως/giu;

  /*
   * The opening "πού/πώς" correction now stays conservative and only touches
   * sentence-initial direct questions. Internal commas, imperative "να"
   * openings, and early subordinate markers are treated as signals that the
   * sentence is explanatory, elliptical, or multi-clause rather than a plain
   * information-seeking question.
   */
  for (const match of text.matchAll(expression)) {
    const source = match[0];
    const start = match.index;
    const end = start + source.length;

    if (!isSentenceStart(text, start)) {
      continue;
    }

    const { sentenceStart, sentenceEnd } = resolveSentenceBounds(text, start, end);
    const sentence = text.slice(sentenceStart, sentenceEnd).trim();

    if (!sentence.endsWith(';')) {
      continue;
    }

    const body = sentence.slice(source.length);
    if (/[.!…·:]/u.test(body)) {
      continue;
    }

    if (body.includes(',')) {
      continue;
    }

    const tokens = readFollowingGreekLikeTokens(sentence, source.length, 6);
    if (tokens.length === 0) {
      continue;
    }

    if (QUESTION_POU_POS_DISALLOWED_OPENERS.has(tokens[0].normalized)) {
      continue;
    }

    if (
      tokens.slice(0, 3).some((token) => QUESTION_POU_POS_EARLY_SUBORDINATORS.has(token.normalized))
    ) {
      continue;
    }

    edits.push({
      start,
      end,
      replacement: applyCasePattern(source, normalizeGreekText(source) === 'που' ? 'πού' : 'πώς'),
    });
  }

  return edits;
}

function buildQuoteCommaTrimEdits(text) {
  return [...text.matchAll(/»,|,»/g)].map((match) => ({
    start: match.index,
    end: match.index + match[0].length,
    replacement: '»',
  }));
}

function buildQuotePeriodPreferenceEdits(text, options) {
  const style = options.preferences.quotePeriodStyle;

  if (style === 'inside') {
    return [...text.matchAll(/»\./g)].map((match) => ({
      start: match.index,
      end: match.index + match[0].length,
      replacement: '.»',
    }));
  }

  /*
   * For outside-quote periods, ellipsis endings ("...") need separate handling:
   * keep the ellipsis inside the quote, add an outside period only at sentence
   * end, and avoid adding one when the sentence clearly continues.
   */
  return [...text.matchAll(/\.»/g)].flatMap((match) => {
    const dotIndex = match.index;
    const quoteIndex = dotIndex + 1;
    const previousOne = text[Math.max(dotIndex - 1, 0)] || '';
    const previousTwo = text[Math.max(dotIndex - 2, 0)] || '';
    const isEllipsisTail = previousOne === '.' && previousTwo === '.';
    const nextChar = text[quoteIndex + 1] || '';

    if (nextChar === '.') {
      return [];
    }

    if (isEllipsisTail) {
      let cursor = quoteIndex + 1;
      while (cursor < text.length && /[ \t]/u.test(text[cursor])) {
        cursor += 1;
      }

      const nextToken = text[cursor] || '';
      const sentenceContinues =
        nextToken === ',' ||
        nextToken === ':' ||
        nextToken === '-' ||
        /[\p{Script=Greek}A-Za-z0-9]/u.test(nextToken);

      if (sentenceContinues) {
        return [];
      }

      return [
        {
          start: dotIndex,
          end: dotIndex + match[0].length,
          replacement: '.».',
        },
      ];
    }

    return [
      {
        start: dotIndex,
        end: dotIndex + match[0].length,
        replacement: '».',
      },
    ];
  });
}

function buildCommaBeforeSubordinatorsEdits(text) {
  /*
   * This comma rule is now limited to the infinitive-purpose connector "για να"
   * so causal and other subordinate links are left to manual editorial choice.
   */
  const expression = new RegExp(
    `(${COMMA_SUBORDINATORS.map(escapeRegex)
      .sort((left, right) => right.length - left.length)
      .join('|')})`,
    'gu',
  );

  return [...text.matchAll(expression)].flatMap((match) => {
    const termStart = match.index;
    const end = termStart + match[0].length;

    if (!isStandaloneWord(text, termStart, end)) {
      return [];
    }

    if (isSentenceStart(text, termStart)) {
      return [];
    }

    let cursor = termStart - 1;
    while (cursor >= 0 && (text[cursor] === ' ' || text[cursor] === '\t')) {
      cursor -= 1;
    }

    if (cursor < 0 || [',', '.', '!', ';', '…', '·', ':'].includes(text[cursor])) {
      return [];
    }

    const { sentenceStart } = resolveSentenceBounds(text, termStart, end);
    const prefix = text.slice(sentenceStart, termStart).trimEnd();
    const previousWords = Array.from(prefix.matchAll(/[\p{Script=Greek}]+/gu)).map((wordMatch) =>
      normalizeGreekText(wordMatch[0]),
    );
    const suffix = text.slice(end, resolveSentenceBounds(text, termStart, end).sentenceEnd);
    const followingWords = Array.from(suffix.matchAll(/[\p{Script=Greek}]+/gu)).map((wordMatch) =>
      normalizeGreekText(wordMatch[0]),
    );

    if (previousWords.length < 2) {
      return [];
    }

    if (followingWords.length <= 3) {
      return [];
    }

    const immediatePreviousWord = previousWords[previousWords.length - 1];
    if (immediatePreviousWord === 'και' || immediatePreviousWord === 'κι') {
      return [];
    }

    return [
      {
        start: cursor + 1,
        end,
        replacement: `, ${match[0]}`,
      },
    ];
  });
}

function buildAnamesaArticleContractEdits(text) {
  /*
   * The contraction after "ανάμεσα ... και ..." now targets only compact noun
   * phrases so it does not overreach into longer clauses. It supports either
   * "ανάμεσα στο/στον/στη/στην <word>" or "ανάμεσα σε <word/article+word>"
   * and contracts the second article family into the corresponding "στ-".
   */
  const replacements = {
    το: 'στο',
    τον: 'στον',
    τη: 'στη',
    την: 'στην',
    τους: 'στους',
    τα: 'στα',
    τις: 'στις',
  };

  const compactPrepositionEdits = collectRegexEdits(
    text,
    /ανάμεσα(\s+)(στο|στον|στη|στην)(\s+)([\p{Script=Greek}]+)(\s+και\s+)(το|τον|τη|την|τους|τα|τις)(\s+)([\p{Script=Greek}]+)/giu,
    {
      boundary: 'word',
      replacementResolver: (match) =>
        `${applyCasePattern(match[0].slice(0, 'ανάμεσα'.length), 'ανάμεσα')}${match[1]}${match[2]}${match[3]}${match[4]}${match[5]}${applyCasePattern(
          match[6],
          replacements[match[6].toLocaleLowerCase(GREEK_LOCALE)],
        )}${match[7]}${match[8]}`,
    },
  );

  const sePhraseEdits = collectRegexEdits(
    text,
    /ανάμεσα(\s+)σε(\s+)(?:(το|τον|τη|την|τους|τα|τις)(\s+))?([\p{Script=Greek}]+)(\s+και\s+)(το|τον|τη|την|τους|τα|τις)(\s+)([\p{Script=Greek}]+)/giu,
    {
      boundary: 'word',
      replacementResolver: (match) => {
        const optionalArticle = match[3] ? `${match[3]}${match[4]}` : '';
        return `${applyCasePattern(match[0].slice(0, 'ανάμεσα'.length), 'ανάμεσα')}${match[1]}σε${match[2]}${optionalArticle}${match[5]}${match[6]}${applyCasePattern(
          match[7],
          replacements[match[7].toLocaleLowerCase(GREEK_LOCALE)],
        )}${match[8]}${match[9]}`;
      },
    },
  );

  return [...compactPrepositionEdits, ...sePhraseEdits].sort(
    (left, right) => left.start - right.start,
  );
}

/*
 * The genitive-only replacements target only the fixed prepositional readings
 * of "λόγω" and "βάσει". They require a safe phrase boundary and a following
 * genitive article phrase so noun uses such as "ο λόγος..." and "η βάση..."
 * are not rewritten.
 */
function buildLogoGenitiveNormalizeEdits(text) {
  return collectRegexEdits(text, /λόγο|λογο/giu, {
    boundary: 'word',
    shouldReplace: (_match, value, start, end) =>
      hasSafePrepositionBoundary(value, start) &&
      startsWithGenitiveArticlePhrase(readFollowingGreekLikeTokens(value, end, 3)),
    replacementResolver: (match) => applyCasePattern(match[0], 'λόγω'),
  });
}

function buildVaseiGenitiveNormalizeEdits(text) {
  const standaloneEdits = collectRegexEdits(text, /βάση|βαση/giu, {
    boundary: 'word',
    shouldReplace: (_match, value, start, end) =>
      hasSafePrepositionBoundary(value, start) &&
      startsWithGenitiveArticlePhrase(readFollowingGreekLikeTokens(value, end, 3)),
    replacementResolver: (match) => applyCasePattern(match[0], 'βάσει'),
  });

  const mePhraseEdits = collectRegexEdits(text, /με(\s+)βάση|με(\s+)βαση/giu, {
    boundary: 'word',
    shouldReplace: (_match, value, _start, end) =>
      startsWithGenitiveArticlePhrase(readFollowingGreekLikeTokens(value, end, 3)),
    replacementResolver: (match) => applyCasePattern(match[0], 'βάσει'),
  });

  return [...standaloneEdits, ...mePhraseEdits].sort((left, right) => left.start - right.start);
}

function buildStoToContractEdits(text) {
  const targets = [
    'είπα',
    'έδωσα',
    'έστειλα',
    'έγραψα',
    'εξήγησα',
    'έδειξα',
    'ζήτησα',
    'θύμισα',
    'έφερα',
    'είχα πει',
  ];

  const expression = new RegExp(`στο(?=\\s+(?:${targets.map(escapeRegex).join('|')}))`, 'giu');

  return collectRegexEdits(text, expression, {
    boundary: 'word',
    replacementResolver: (match) => applyCasePattern(match[0], "σ' το"),
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

function buildSkeptikosFamilyEdits(text) {
  return buildPrefixFamilyEdits(text, [
    ['σκεφτηκ', 'σκεπτικ'],
    ['σκεφτικ', 'σκεπτικ'],
    ['σκεφτίκ', 'σκεπτίκ'],
  ]);
}

function buildAntepexerxomaiFamilyEdits(text) {
  return buildPrefixFamilyEdits(text, [['ανταπεξ', 'αντεπεξ']]);
}

function buildApathanatizoFamilyEdits(text) {
  return buildPrefixFamilyEdits(text, [
    ['αποθανατ', 'απαθανατ'],
    ['αποθανατί', 'απαθανατί'],
  ]);
}

function buildTromaktikosFamilyEdits(text) {
  return buildPrefixFamilyEdits(text, [
    ['τρομαχτ', 'τρομακτ'],
    ['τρομαχτί', 'τρομακτί'],
  ]);
}

function buildDachtylaFamilyEdits(text) {
  /*
   * This family rule is intentionally narrow because only the inflections of
   * "δάχτυλο" and "δαχτυλίδι" should be normalized. Other δακτυλ- words such
   * as "δακτύλιος" or "δακτυλογραφία" belong to different lexical families
   * and must stay untouched.
   */
  const replacements = {
    δάκτυλο: 'δάχτυλο',
    δάκτυλα: 'δάχτυλα',
    δάκτυλου: 'δάχτυλου',
    δάκτυλων: 'δάχτυλων',
    δάκτυλον: 'δάχτυλον',
    δακτυλάκι: 'δαχτυλάκι',
    δακτυλάκια: 'δαχτυλάκια',
    δακτυλιού: 'δαχτυλιού',
    δακτυλιών: 'δαχτυλιών',
    δακτυλίδι: 'δαχτυλίδι',
    δακτυλίδια: 'δαχτυλίδια',
    δακτυλιδιού: 'δαχτυλιδιού',
    δακτυλιδιών: 'δαχτυλιδιών',
  };

  return buildMappedWordEdits(text, replacements);
}

function buildNychtaFamilyEdits(text) {
  return collectRegexEdits(text, GREEK_WORD_REGEX, {
    boundary: 'word',
    shouldReplace: (match, value, start, end) => {
      const normalized = normalizeGreekText(match[0]);
      if (!normalized.startsWith('νυκτ')) {
        return false;
      }

      const previousWord = resolvePreviousGreekWord(value, start);
      if (
        normalized === 'νυκτος' &&
        previousWord &&
        normalizeGreekText(previousWord.word) === 'κρεμα'
      ) {
        return false;
      }

      return isStandaloneWord(value, start, end);
    },
    replacementResolver: (match) => {
      const source = match[0];
      const lowered = source.toLocaleLowerCase(GREEK_LOCALE);
      const pair = lowered.startsWith('νύκτ') ? ['νύκτ', 'νύχτ'] : ['νυκτ', 'νυχτ'];

      return replacePrefixWithCase(source, pair[0], pair[1]);
    },
  });
}

function buildMyesEdits(text) {
  return collectRegexEdits(text, /τους((?:\s+[\p{Script=Greek}]+)?\s+)μύες|οι(\s+)μυς/giu, {
    boundary: 'word',
    replacementResolver: (match) => {
      if (normalizeGreekText(match[0]).startsWith('τους')) {
        return `τους${match[1]}μυς`;
      }

      return `οι${match[2]}μύες`;
    },
  });
}

function buildNobilityTitlesLowercaseEdits(text) {
  const expression = new RegExp(
    Array.from(NOBILITY_TITLES.keys()).map(escapeRegex).join('|'),
    'giu',
  );

  return collectRegexEdits(text, expression, {
    boundary: 'word',
    shouldReplace: (match, value, start, end) => {
      if (isSentenceStart(value, start)) {
        return false;
      }

      return (
        match[0] !== match[0].toLocaleLowerCase(GREEK_LOCALE) && isStandaloneWord(value, start, end)
      );
    },
    replacementResolver: (match) =>
      NOBILITY_TITLES.get(match[0].toLocaleLowerCase(GREEK_LOCALE)) || match[0],
  });
}

function buildNiothoFamilyEdits(text) {
  /*
   * The preferred modern spelling for this family is the compact "νιώθ-/νιώσ-"
   * form, so older "νοιώθ-/νοιώσ-" variants are folded into that target.
   */
  return buildPrefixFamilyEdits(text, [
    ['νοιώθ', 'νιώθ'],
    ['νοιωθ', 'νιωθ'],
    ['νοιώσ', 'νιώσ'],
    ['νοιωσ', 'νιωσ'],
  ]);
}

function buildDechtikaFamilyEdits(text) {
  return buildPrefixFamilyEdits(text, [
    ['δέχθ', 'δέχτ'],
    ['δεχθ', 'δεχτ'],
    ['παραδέχθ', 'παραδέχτ'],
    ['παραδεχθ', 'παραδεχτ'],
    ['αποδέχθ', 'απόδεχτ'],
    ['αποδεχθ', 'αποδεχτ'],
  ]);
}

function buildPopoEdits(text) {
  return collectRegexEdits(text, /πω\s*πω+|πωπώ/giu, {
    boundary: 'word',
    replacementResolver: (match) => applyCasePattern(match[0], 'ποπό'),
  });
}

function buildChairetisaFamilyEdits(text) {
  return collectRegexEdits(text, /[\p{Script=Greek}]+/gu, {
    boundary: 'word',
    shouldReplace: (match) =>
      /^(χαιρέτισ(?:α|ες|ε|αμε|ατε|αν)|χαιρετίσ(?:α|ες|ε|αμε|ατε|αν))$/iu.test(match[0]),
    replacementResolver: (match) => {
      const source = match[0];
      if (normalizeGreekText(source).startsWith('χαιρετισ')) {
        return replacePrefixWithCase(
          source,
          source.includes('ί') ? 'χαιρετίσ' : 'χαιρέτισ',
          source.includes('ί') ? 'χαιρετήσ' : 'χαιρέτησ',
        );
      }

      return source;
    },
  });
}

function buildKyriarXNoHyphenEdits(text) {
  return collectRegexEdits(text, /(κυρ|πάτερ|καπετάν)-(?=[\p{Script=Greek}])/giu, {
    replacementResolver: (match) => `${match[1]} `,
  });
}

function buildFysixoFamilyEdits(text) {
  const replacements = {
    φύσησα: 'φύσηξα',
    φύσησες: 'φύσηξες',
    φύσησε: 'φύσηξε',
    φύσησαν: 'φύσηξαν',
    ξεφύσησα: 'ξεφύσηξα',
    ξεφύσησες: 'ξεφύσηξες',
    ξεφύσησε: 'ξεφύσηξε',
    ξεφύσησαν: 'ξεφύσηξαν',
  };

  return buildMappedWordEdits(text, replacements);
}

function buildAndrasPreferenceEdits(text, options) {
  return buildMappedWordEdits(text, ANDRAS_TARGET_MAP[options.preferences.andrasStyle]);
}

function buildAvgoPreferenceEdits(text, options) {
  return buildMappedWordEdits(text, AVGO_TARGET_MAP[options.preferences.avgoStyle]);
}

function buildEptaPreferenceEdits(text, options) {
  return buildMappedWordEdits(text, EPTA_TARGET_MAP[options.preferences.eptaStyle]);
}

function buildOktoPreferenceEdits(text, options) {
  return buildMappedWordEdits(text, OKTO_TARGET_MAP[options.preferences.oktoStyle]);
}

function buildEnniaPreferenceEdits(text, options) {
  return buildMappedWordEdits(text, ENNIA_TARGET_MAP[options.preferences.enniaStyle]);
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
        if (COLLOQUIAL_PROGRESSIVE_EXCLUDED_WORD_STEMS.has(stem)) {
          return false;
        }

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
  { id: 'comma_space_normalize', apply: buildCommaSpaceEdits },
  { id: 'period_space_normalize', apply: buildPeriodSpaceEdits },
  { id: 'guillemets_normalize', apply: buildGuillemetsEdits },
  { id: 'den_negation_trim', apply: buildDenNegationPreferenceEdits },
  { id: 'akomi_to_akoma_before_kai', apply: buildAkomaBeforeKaiEdits },
  {
    id: 'giati_giati_normalize',
    apply: (text) => buildMappedPhraseEdits(text, DIRECT_PHRASE_REPLACEMENTS.giati_giati_normalize),
  },
  { id: 'me_se_mena_sena_contract', apply: buildMeSeMenaSenaEdits },
  { id: 'prin_before_time_phrase', apply: buildPrinBeforeTimePhraseEdits },
  { id: 'question_pou_pos_toning', apply: buildQuestionPouPosToningEdits },
  { id: 'quote_comma_trim', apply: buildQuoteCommaTrimEdits },
  { id: 'quote_period_preference', apply: buildQuotePeriodPreferenceEdits },
  { id: 'logo_genitive_normalize', apply: buildLogoGenitiveNormalizeEdits },
  { id: 'vasei_genitive_normalize', apply: buildVaseiGenitiveNormalizeEdits },
  {
    id: 'kyriarx_no_hyphen',
    apply: buildKyriarXNoHyphenEdits,
  },
  {
    id: 'mesa_sto_contract',
    apply: (text) => buildMappedPhraseEdits(text, DIRECT_PHRASE_REPLACEMENTS.mesa_sto_contract),
  },
  {
    id: 'kathe_enas_series',
    apply: (text) => buildMappedPhraseEdits(text, DIRECT_PHRASE_REPLACEMENTS.kathe_enas_series),
  },
  {
    id: 'pou_kai_pou_toning',
    apply: (text) => buildMappedPhraseEdits(text, DIRECT_WORD_REPLACEMENTS.pou_kai_pou_toning),
  },
  {
    id: 'theos_phrases_normalize',
    apply: buildTheosPhraseEdits,
  },
  { id: 'comma_before_subordinators', apply: buildCommaBeforeSubordinatorsEdits },
  { id: 'anamesa_article_contract', apply: buildAnamesaArticleContractEdits },
  { id: 'sto_to_contract', apply: buildStoToContractEdits },
  { id: 'vromia_family_omicron', apply: buildVromiaFamilyEdits },
  { id: 'antikrizo_family_iota', apply: buildAntikrizoFamilyEdits },
  { id: 'klotso_family_omicron', apply: buildKlotsoFamilyEdits },
  { id: 'skeptikos_family_normalize', apply: buildSkeptikosFamilyEdits },
  { id: 'tromaktikos_family_normalize', apply: buildTromaktikosFamilyEdits },
  { id: 'dachtyla_family_normalize', apply: buildDachtylaFamilyEdits },
  { id: 'nychta_family_normalize', apply: buildNychtaFamilyEdits },
  { id: 'antepexerxomai_normalize', apply: buildAntepexerxomaiFamilyEdits },
  { id: 'apathanatizo_normalize', apply: buildApathanatizoFamilyEdits },
  { id: 'niotho_family_normalize', apply: buildNiothoFamilyEdits },
  { id: 'dechtika_family_normalize', apply: buildDechtikaFamilyEdits },
  { id: 'nobility_titles_lowercase', apply: buildNobilityTitlesLowercaseEdits },
  { id: 'epta_preference', apply: buildEptaPreferenceEdits },
  { id: 'okto_preference', apply: buildOktoPreferenceEdits },
  { id: 'ennia_preference', apply: buildEnniaPreferenceEdits },
  { id: 'andras_preference', apply: buildAndrasPreferenceEdits },
  {
    id: 'fos_normalize',
    apply: (text) => buildMappedWordEdits(text, DIRECT_WORD_REPLACEMENTS.fos_normalize),
  },
  {
    id: 'apo_tonos_normalize',
    apply: (text) => buildMappedWordEdits(text, DIRECT_WORD_REPLACEMENTS.apo_tonos_normalize),
  },
  {
    id: 'och_interjection_normalize',
    apply: (text) =>
      buildMappedWordEdits(text, DIRECT_WORD_REPLACEMENTS.och_interjection_normalize),
  },
  {
    id: 'poios_family_tonos_normalize',
    apply: (text) => buildMappedWordEdits(text, POIOS_TONOS_MAP),
  },
  {
    id: 'mia_tonos_normalize',
    apply: (text) => buildMappedWordEdits(text, { μιά: 'μια' }),
  },
  {
    id: 'dyo_tonos_normalize',
    apply: (text) => buildMappedWordEdits(text, { δυό: 'δυο' }),
  },
  {
    id: 'ti_tonos_normalize',
    apply: (text) => buildMappedWordEdits(text, { τί: 'τι' }),
  },
  {
    id: 'pio_family_tonos_normalize',
    apply: (text) => buildMappedWordEdits(text, PIO_TONOS_MAP),
  },
  {
    id: 'mpas_normalize',
    apply: (text) => buildMappedWordEdits(text, DIRECT_WORD_REPLACEMENTS.mpas_normalize),
  },
  {
    id: 'gios_family_tonos_normalize',
    apply: (text) => buildMappedWordEdits(text, GIOS_TONOS_MAP),
  },
  {
    id: 'nai_tonos_normalize',
    apply: (text) => buildMappedWordEdits(text, DIRECT_WORD_REPLACEMENTS.nai_tonos_normalize),
  },
  {
    id: 'thes_tonos_normalize',
    apply: (text) => buildMappedWordEdits(text, DIRECT_WORD_REPLACEMENTS.thes_tonos_normalize),
  },
  {
    id: 'op_interjection_normalize',
    apply: (text) => buildMappedWordEdits(text, DIRECT_WORD_REPLACEMENTS.op_interjection_normalize),
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
    id: 'oson_afora_normalize',
    apply: (text) => buildMappedPhraseEdits(text, DIRECT_PHRASE_REPLACEMENTS.oson_afora_normalize),
  },
  {
    id: 'ap_oti_normalize',
    apply: (text) => buildMappedPhraseEdits(text, DIRECT_PHRASE_REPLACEMENTS.ap_oti_normalize),
  },
  {
    id: 'ypopsi_normalize',
    apply: (text) => buildMappedPhraseEdits(text, DIRECT_PHRASE_REPLACEMENTS.ypopsi_normalize),
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
  {
    id: 'sintrivani_normalize',
    apply: (text) => buildMappedWordEdits(text, DIRECT_WORD_REPLACEMENTS.sintrivani_normalize),
  },
  {
    id: 'zaploutos_normalize',
    apply: (text) => buildMappedWordEdits(text, DIRECT_WORD_REPLACEMENTS.zaploutos_normalize),
  },
  {
    id: 'synonthylevma_normalize',
    apply: (text) => buildMappedWordEdits(text, DIRECT_WORD_REPLACEMENTS.synonthylevma_normalize),
  },
  {
    id: 'myes_normalize',
    apply: buildMyesEdits,
  },
  {
    id: 'en_telei_normalize',
    apply: (text) => buildMappedPhraseEdits(text, DIRECT_WORD_REPLACEMENTS.en_telei_normalize),
  },
  {
    id: 'en_merei_normalize',
    apply: (text) => buildMappedPhraseEdits(text, DIRECT_WORD_REPLACEMENTS.en_merei_normalize),
  },
  {
    id: 'haha_spacing_normalize',
    apply: (text) => buildMappedWordEdits(text, DIRECT_WORD_REPLACEMENTS.haha_spacing_normalize),
  },
  {
    id: 'popo_normalize',
    apply: buildPopoEdits,
  },
  {
    id: 'dei_family_tonos_normalize',
    apply: (text) => buildMappedWordEdits(text, DEI_TONOS_MAP),
  },
  {
    id: 'chairetisa_family_normalize',
    apply: buildChairetisaFamilyEdits,
  },
  {
    id: 'xtes_family_normalize',
    apply: (text) => buildMappedWordEdits(text, XTES_MAP),
  },
  {
    id: 'geia_tonos_normalize',
    apply: (text) => buildMappedWordEdits(text, DIRECT_WORD_REPLACEMENTS.geia_tonos_normalize),
  },
  {
    id: 'mov_normalize',
    apply: (text) => buildMappedWordEdits(text, DIRECT_WORD_REPLACEMENTS.mov_normalize),
  },
  {
    id: 'xefysixe_normalize',
    apply: buildFysixoFamilyEdits,
  },
  {
    id: 'me_mias_normalize',
    apply: (text) => buildMappedPhraseEdits(text, DIRECT_PHRASE_REPLACEMENTS.me_mias_normalize),
  },
  {
    id: 'ex_archis_normalize',
    apply: (text) => buildMappedPhraseEdits(text, DIRECT_PHRASE_REPLACEMENTS.ex_archis_normalize),
  },
  {
    id: 'fixed_hyphenated_phrases_normalize',
    apply: (text) =>
      buildMappedPhraseEdits(text, DIRECT_PHRASE_REPLACEMENTS.fixed_hyphenated_phrases_normalize),
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
  const eptaStyle = String(rawPreferences.eptaStyle || 'epta').trim();
  const oktoStyle = String(rawPreferences.oktoStyle || 'okto').trim();
  const enniaStyle = String(rawPreferences.enniaStyle || 'ennia').trim();
  const denNegationStyle = String(rawPreferences.denNegationStyle || 'contextual').trim();
  const quotePeriodStyle = String(rawPreferences.quotePeriodStyle || 'outside').trim();

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

  if (!EPTA_STYLE_VALUES.has(eptaStyle)) {
    throw new ApiError(400, 'INVALID_RULE_PREFERENCE', 'Unsupported eptaStyle preference', {
      details: [
        {
          field: 'editorOptions.preferences.eptaStyle',
          issue: 'Allowed values are epta, efta',
        },
      ],
    });
  }

  if (!OKTO_STYLE_VALUES.has(oktoStyle)) {
    throw new ApiError(400, 'INVALID_RULE_PREFERENCE', 'Unsupported oktoStyle preference', {
      details: [
        {
          field: 'editorOptions.preferences.oktoStyle',
          issue: 'Allowed values are okto, oxto',
        },
      ],
    });
  }

  if (!ENNIA_STYLE_VALUES.has(enniaStyle)) {
    throw new ApiError(400, 'INVALID_RULE_PREFERENCE', 'Unsupported enniaStyle preference', {
      details: [
        {
          field: 'editorOptions.preferences.enniaStyle',
          issue: 'Allowed values are ennia, ennea',
        },
      ],
    });
  }

  if (!DEN_NEGATION_STYLE_VALUES.has(denNegationStyle)) {
    throw new ApiError(400, 'INVALID_RULE_PREFERENCE', 'Unsupported denNegationStyle preference', {
      details: [
        {
          field: 'editorOptions.preferences.denNegationStyle',
          issue: 'Allowed values are contextual, alwaysDen',
        },
      ],
    });
  }

  if (!QUOTE_PERIOD_STYLE_VALUES.has(quotePeriodStyle)) {
    throw new ApiError(400, 'INVALID_RULE_PREFERENCE', 'Unsupported quotePeriodStyle preference', {
      details: [
        {
          field: 'editorOptions.preferences.quotePeriodStyle',
          issue: 'Allowed values are inside, outside',
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
      eptaStyle,
      oktoStyle,
      enniaStyle,
      denNegationStyle,
      quotePeriodStyle,
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
