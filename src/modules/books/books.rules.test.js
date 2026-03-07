/*
  Rule tests lock the Greek-language transformations so future additions can
  extend the registry without breaking the editor behavior already promised.
*/
import test from 'node:test';
import assert from 'node:assert/strict';
import { applyGreekEditorRules } from './books.rules.js';

test('kai_before_vowel turns standalone και into κι before vowels', () => {
  const result = applyGreekEditorRules('και αγάπη και Ελπίδα', ['kai_before_vowel']);
  assert.equal(result.text, 'κι αγάπη κι Ελπίδα');
});

test('stin_article_trim shortens στην and την only for supported consonants', () => {
  const result = applyGreekEditorRules('στην βροχή την λάμψη στην γκαλερί', ['stin_article_trim']);
  assert.equal(result.text, 'στη βροχή τη λάμψη στην γκαλερί');
});

test('min_negation_trim skips gamma-kappa, mu-pi, and nu-tau digraph starts', () => {
  const result = applyGreekEditorRules('μην βγεις μην γκρινιάζεις μην μπλέξεις μην ντρεπεσαι', [
    'min_negation_trim',
  ]);
  assert.equal(result.text, 'μη βγεις μην γκρινιάζεις μην μπλέξεις μην ντρεπεσαι');
});

test('sa_to_san preserves standalone boundaries and casing', () => {
  const result = applyGreekEditorRules('Σα λύκος, μα όχι μέσα στη λέξη σαλόνι', ['sa_to_san']);
  assert.equal(result.text, 'Σαν λύκος, μα όχι μέσα στη λέξη σαλόνι');
});

test('ellipsis_normalize collapses runs longer than three periods', () => {
  const result = applyGreekEditorRules('Περίμενε..... τώρα.... αμέσως...', ['ellipsis_normalize']);
  assert.equal(result.text, 'Περίμενε... τώρα... αμέσως...');
});
