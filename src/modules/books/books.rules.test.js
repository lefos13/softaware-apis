/*
 * Rule tests lock the growing Greek editor catalog so new literary and
 * orthographic rules do not regress the original correction behavior.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { applyGreekEditorRules, normalizeBooksEditorOptions } from './books.rules.js';

const applyRules = (text, ruleIds, extra = {}) =>
  applyGreekEditorRules(text, {
    ruleIds,
    ...extra,
  });

test('original literary rules still transform the expected cases', () => {
  const result = applyRules('και αγάπη στην βροχή μην βγεις σα λύκος.....', [
    'kai_before_vowel',
    'stin_article_trim',
    'min_negation_trim',
    'sa_to_san',
    'ellipsis_normalize',
  ]);

  assert.equal(result.text, 'κι αγάπη στη βροχή μη βγεις σαν λύκος...');
});

test('new literary rules normalize spacing, guillemets, δεν, ακόμα, προτού, and contractions', () => {
  const result = applyRules('<<δεν  βγαίνω>> ακόμη και πριν να πω με μένα και σε σένα', [
    'multiple_spaces_normalize',
    'guillemets_normalize',
    'den_negation_trim',
    'akomi_to_akoma_before_kai',
    'prin_na_to_protou',
    'me_se_mena_sena_contract',
  ]);

  assert.equal(result.text, "«δε βγαίνω» ακόμα και προτού πω μ' εμένα και σ' εσένα");
});

test('den negation rule supports global δεν preference', () => {
  const result = applyRules('δε βγαίνω και δεν μένω', ['den_negation_trim'], {
    preferences: { denNegationStyle: 'alwaysDen' },
  });

  assert.equal(result.text, 'δεν βγαίνω και δεν μένω');
});

test('new literary phrase replacements normalize μέσα στο, κάθε ένας, με μιας, and εξ αρχής', () => {
  const result = applyRules('μέσα στο σπίτι κάθε ένας με μιας και εξ αρχής το ξέρει', [
    'mesa_sto_contract',
    'kathe_enas_series',
    'me_mias_normalize',
    'ex_archis_normalize',
  ]);

  assert.equal(result.text, 'μες στο σπίτι καθένας μεμιάς και εξαρχής το ξέρει');
});

test('new literary phrase rules normalize before-phrases, quote punctuation, syntax phrases, and fixed contractions', () => {
  const result = applyRules(
    'Πριν το μάθημα είπε: «Γύρισα»,. Θα φύγω πριν δεκαπέντε χρόνια και πριν τις δέκα το βράδυ. Ήταν πριν πολύ καιρό, πριν τέσσερις δεκαετίες, πριν κάτι μήνες, πριν πολλά πολλά χρόνια, πριν λίγες μέρες και πριν σχεδόν μισό αιώνα. ανάμεσα στην πόλη και την θάλασσα στο είπα δόξα τον Θεό που και που έρχομαι και φεύγω όταν θέλω',
    [
      'prin_before_time_phrase',
      'quote_comma_trim',
      'theos_phrases_normalize',
      'comma_before_subordinators',
      'anamesa_article_contract',
      'sto_to_contract',
    ],
  );

  assert.equal(
    result.text,
    "Πριν από το μάθημα είπε: «Γύρισα». Θα φύγω πριν από δεκαπέντε χρόνια και πριν από τις δέκα το βράδυ. Ήταν πριν από πολύ καιρό, πριν από τέσσερις δεκαετίες, πριν από κάτι μήνες, πριν από πολλά πολλά χρόνια, πριν από λίγες μέρες και πριν από σχεδόν μισό αιώνα. ανάμεσα στην πόλη και στην θάλασσα σ' το είπα δόξα τω Θεώ που και που έρχομαι και φεύγω όταν θέλω",
  );
});

test('prin_before_time_phrase also covers short time expressions and embedded clauses', () => {
  const result = applyRules(
    'πριν λίγο καιρό, πριν μέρες, πριν λίγο είπες, πριν λίγο το έφτιαξα, πριν χρόνια, μέχρι πριν λίγο το ήξερα',
    ['prin_before_time_phrase'],
  );

  assert.equal(
    result.text,
    'πριν από λίγο καιρό, πριν από μέρες, πριν από λίγο είπες, πριν από λίγο το έφτιαξα, πριν από χρόνια, μέχρι πριν από λίγο το ήξερα',
  );
});

test('question opening words, repeated phrase toning, and quote-period preference apply correctly', () => {
  const result = applyRules(
    'Που πήγες; πως και πως σε περίμενα. Το δωμάτιο μου είπε «γύρνα».',
    ['question_pou_pos_toning', 'pou_kai_pou_toning', 'quote_period_preference'],
    {
      preferences: { quotePeriodStyle: 'inside' },
    },
  );

  assert.equal(result.text, 'Πού πήγες; πώς και πώς σε περίμενα. Το δωμάτιο μου είπε «γύρνα.»');
});

test('comma-before-subordinators only changes standalone words and not word fragments', () => {
  const result = applyRules('Ο Γκέχαρντ Μίλερ ήταν χαρούμενος αλλά έφυγε όταν νύχτωσε.', [
    'comma_before_subordinators',
  ]);

  assert.equal(result.text, 'Ο Γκέχαρντ Μίλερ ήταν χαρούμενος αλλά έφυγε όταν νύχτωσε.');
});

test('comma-before-subordinators skips excluded terms, short prefixes, and και/κι prefixes', () => {
  const result = applyRules(
    'Θα φύγω μέχρι νυχτώσει. Είπε αν θέλεις. Ρώτησε εάν προλαβαίνεις. Έφυγα όταν νύχτωσε. Γύρισα και όταν έφτασε σώπασα. Μίλησα κι όταν έμαθα περισσότερα.',
    ['comma_before_subordinators'],
  );

  assert.equal(
    result.text,
    'Θα φύγω μέχρι νυχτώσει. Είπε αν θέλεις. Ρώτησε εάν προλαβαίνεις. Έφυγα όταν νύχτωσε. Γύρισα και όταν έφτασε σώπασα. Μίλησα κι όταν έμαθα περισσότερα.',
  );
});

test('comma-before-subordinators skips clauses with three or fewer following words', () => {
  const result = applyRules(
    'Γύρισα αργά όταν νύχτωσε πολύ. Μίλησα ήρεμα γιατί το ήθελα πραγματικά.',
    ['comma_before_subordinators'],
  );

  assert.equal(
    result.text,
    'Γύρισα αργά όταν νύχτωσε πολύ. Μίλησα ήρεμα γιατί το ήθελα πραγματικά.',
  );
});

test('negation trimming still skips gamma-kappa, mu-pi, and nu-tau digraph starts', () => {
  const result = applyRules('μην γκρινιάζεις μην μπλέξεις δεν ντράπηκα', [
    'min_negation_trim',
    'den_negation_trim',
  ]);

  assert.equal(result.text, 'μην γκρινιάζεις μην μπλέξεις δεν ντράπηκα');
});

test('orthography family rules normalize βρομιά, αντικρίζω, and κλοτσώ families', () => {
  const result = applyRules('βρωμιά Βρώμικος αντικρύζω Κλωτσάω', [
    'vromia_family_omicron',
    'antikrizo_family_iota',
    'klotso_family_omicron',
  ]);

  assert.equal(result.text, 'βρομιά Βρόμικος αντικρίζω Κλοτσάω');
});

test('preference rules switch άντρας and αβγό families based on selected preference', () => {
  const result = applyRules('άνδρας άνδρες αυγό αυγά', ['andras_preference', 'avgo_preference'], {
    preferences: {
      andrasStyle: 'antras',
      avgoStyle: 'avgoBeta',
    },
  });

  assert.equal(result.text, 'άντρας άντρες αβγό αβγά');
});

test('direct orthography replacements normalize standalone words and phrases', () => {
  const result = applyRules(
    "ωχ ζήλεια κτήριο εταιρία παρ' όλο που παρόλα αυτά περεπιπτόντως συγνώμη μπύρα ξύδι πάρτυ στυλ ξυπόλητος χρονών φύσησε φύσησαν ξεφύσησε ξεφύσησαν με μιας εξ αρχής οκ σιγά-σιγά χέρι-χέρι",
    [
      'och_interjection_normalize',
      'zilia_normalize',
      'ktirio_normalize',
      'etaireia_normalize',
      'parolo_pou_normalize',
      'par_ola_auta_normalize',
      'parempiptontos_normalize',
      'syngnomi_normalize',
      'bira_normalize',
      'xidi_normalize',
      'parti_normalize',
      'stil_normalize',
      'xipolytos_normalize',
      'chronon_normalize',
      'xefysixe_normalize',
      'me_mias_normalize',
      'ex_archis_normalize',
      'ok_uppercase',
      'siga_siga_spacing',
      'cheri_cheri_spacing',
    ],
  );

  assert.equal(
    result.text,
    "οχ ζήλια κτίριο εταιρεία παρόλο που παρ' όλα αυτά παρεμπιπτόντως συγγνώμη μπίρα ξίδι πάρτι στιλ ξυπόλυτος χρόνων φύσηξε φύσηξαν ξεφύσηξε ξεφύσηξαν μεμιάς εξαρχής ΟΚ σιγά σιγά χέρι χέρι",
  );
});

test('orthography family rules also normalize the σκεπτικός family', () => {
  const result = applyRules('σκεφτηκός Σκεφτική σκεφτικοί', ['skeptikos_family_normalize']);

  assert.equal(result.text, 'σκεπτικός Σκεπτική σκεπτικοί');
});

test('colloquial past progressive rule converts common -αγα endings to -ούσα forms', () => {
  const result = applyRules(
    'περπάταγα αγαπούσες τραγούδαγες μίλαγε περνάγαμε κοιτάγατε τρέχαγανε',
    ['colloquial_past_progressive_normalize'],
  );

  assert.equal(
    result.text,
    'περπατούσα αγαπούσες τραγουδούσες μιλούσε περνούσαμε κοιτούσατε τρεχούσαν',
  );
});

test('reports include detailed change entries', () => {
  const result = applyRules('Ορμούσε σα λύκος. Μετά σταμάτησε.', ['sa_to_san']);

  assert.equal(result.totalReplacements, 1);
  assert.equal(result.changes.length, 1);
  assert.equal(result.changes[0].before, 'σα');
  assert.equal(result.changes[0].after, 'σαν');
  assert.equal(result.changes[0].sentenceBefore, 'Ορμούσε σα λύκος.');
  assert.equal(result.changes[0].sentenceAfter, 'Ορμούσε σαν λύκος.');
});

test('normalizeBooksEditorOptions validates supported preferences', () => {
  assert.throws(
    () =>
      normalizeBooksEditorOptions({
        ruleIds: ['andras_preference'],
        preferences: { andrasStyle: 'invalid' },
      }),
    (error) => error.code === 'INVALID_RULE_PREFERENCE',
  );

  assert.throws(
    () =>
      normalizeBooksEditorOptions({
        ruleIds: ['quote_period_preference'],
        preferences: { quotePeriodStyle: 'invalid' },
      }),
    (error) => error.code === 'INVALID_RULE_PREFERENCE',
  );

  assert.throws(
    () =>
      normalizeBooksEditorOptions({
        ruleIds: ['den_negation_trim'],
        preferences: { denNegationStyle: 'invalid' },
      }),
    (error) => error.code === 'INVALID_RULE_PREFERENCE',
  );
});

test('colloquial past progressive rule skips σπάω, σκάω, κλαίω families', () => {
  const result = applyRules('έσπαγα το ποτήρι, έσκαγε ο τοίχος, έκλαιγε και περπάταγα στο δρόμο', [
    'colloquial_past_progressive_normalize',
  ]);

  assert.equal(result.text, 'έσπαγα το ποτήρι, έσκαγε ο τοίχος, έκλαιγε και περπατούσα στο δρόμο');
});
