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
    "ωχ ζήλεια κτήριο εταιρία παρ' όλο που παρόλα αυτά περεπιπτόντως συγνώμη μπύρα ξύδι πάρτυ στυλ ξυπόλητος χρονών οκ σιγά-σιγά χέρι-χέρι",
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
      'ok_uppercase',
      'siga_siga_spacing',
      'cheri_cheri_spacing',
    ],
  );

  assert.equal(
    result.text,
    "οχ ζήλια κτίριο εταιρεία παρόλο που παρ' όλα αυτά παρεμπιπτόντως συγγνώμη μπίρα ξίδι πάρτι στιλ ξυπόλυτος χρόνων ΟΚ σιγά σιγά χέρι χέρι",
  );
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
});

test('colloquial past progressive rule skips σπάω, σκάω, κλαίω families', () => {
  const result = applyRules('έσπαγα το ποτήρι, έσκαγε ο τοίχος, έκλαιγε και περπάταγα στο δρόμο', [
    'colloquial_past_progressive_normalize',
  ]);

  assert.equal(result.text, 'έσπαγα το ποτήρι, έσκαγε ο τοίχος, έκλαιγε και περπατούσα στο δρόμο');
});
