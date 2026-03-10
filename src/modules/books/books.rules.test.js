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
  const result = applyRules(
    'και αγάπη στην βροχή αυτή τη μπάλα αυτή την καρέκλα μη γκρινιάζεις μην βγεις σα λύκος.....',
    [
      'kai_before_vowel',
      'stin_article_trim',
      'min_negation_trim',
      'sa_to_san',
      'ellipsis_normalize',
    ],
  );

  assert.equal(
    result.text,
    'κι αγάπη στη βροχή αυτή την μπάλα αυτήν τη καρέκλα μην γκρινιάζεις μη βγεις σαν λύκος...',
  );
});

test('new literary rules normalize spacing, guillemets, δεν, ακόμα, προτού, and contractions', () => {
  const result = applyRules(
    '<<δεν  βγαίνω>>,ακόμη και πριν να πω με μένα και σε σένα.Ύστερα είπε.»Τέλος». Και το 3.14 μένει ίδιο και ό,τι θέλεις.',
    [
      'multiple_spaces_normalize',
      'comma_space_normalize',
      'period_space_normalize',
      'guillemets_normalize',
      'den_negation_trim',
      'akomi_to_akoma_before_kai',
      'me_se_mena_sena_contract',
    ],
  );

  assert.equal(
    result.text,
    "«δε βγαίνω», ακόμα και πριν να πω μ' εμένα και σ' εσένα. Ύστερα είπε.»Τέλος». Και το 3.14 μένει ίδιο και ό,τι θέλεις.",
  );
});

test('comma spacing keeps commas attached before a closing guillemet', () => {
  const result = applyRules('Είπε,\u00BB και έφυγε', ['comma_space_normalize']);

  assert.equal(result.text, 'Είπε,\u00BB και έφυγε');
});

/*
 * Prevents sentence-period spacing from splitting consecutive dots while still
 * enforcing a space after a standalone period before the next sentence.
 */
test('period spacing skips consecutive dots and only spaces standalone sentence periods', () => {
  const result = applyRules('Περίμενε..και είδε...ξανά.Τέλος', ['period_space_normalize']);

  assert.equal(result.text, 'Περίμενε.. και είδε... ξανά. Τέλος');
});

test('den negation rule supports global δεν preference', () => {
  const result = applyRules('δε βγαίνω και δεν μένω', ['den_negation_trim'], {
    preferences: { denNegationStyle: 'alwaysDen' },
  });

  assert.equal(result.text, 'δεν βγαίνω και δεν μένω');
});

test('new literary phrase replacements normalize μέσα στο, κάθε ένας, με μιας, and εξ αρχής', () => {
  const result = applyRules(
    'μέσα στο σπίτι κάθε ένας με μιας και εξ αρχής το ξέρει κυρ-Αλέξης πάτερ-Νικόλα καπετάν-Μιχάλης',
    [
      'mesa_sto_contract',
      'kathe_enas_series',
      'me_mias_normalize',
      'ex_archis_normalize',
      'kyriarx_no_hyphen',
    ],
  );

  assert.equal(
    result.text,
    'μες στο σπίτι καθένας μεμιάς και εξαρχής το ξέρει κυρ Αλέξης πάτερ Νικόλα καπετάν Μιχάλης',
  );
});

/*
 * The contracted target form uses the typographic apostrophe so all supported
 * spacing and apostrophe variants of "για αυτό" resolve to one output.
 */
test('γι αυτό phrase variants normalize to "γι’ αυτό"', () => {
  const result = applyRules("για αυτό, γι αυτό και γι' αυτό είπα όχι", ['giati_giati_normalize']);

  assert.equal(result.text, 'γι’ αυτό, γι’ αυτό και γι’ αυτό είπα όχι');
});

test('new literary phrase rules normalize before-phrases, quote punctuation, syntax phrases, and fixed contractions', () => {
  const result = applyRules(
    'Πριν το μάθημα είπε: «Γύρισα», και «γύρνα,» . Θα φύγω πριν δεκαπέντε χρόνια και πριν τις δέκα το βράδυ. Ήταν πριν πολύ καιρό, πριν τέσσερις δεκαετίες, πριν κάτι μήνες, πριν πολλά πολλά χρόνια, πριν λίγες μέρες και πριν σχεδόν μισό αιώνα. ανάμεσα στην πόλη και την θάλασσα, ανάμεσα σε φίλους και τους γείτονες, ανάμεσα σε τη θάλασσα και τις πέτρες στο είπα δόξα τον Θεό που και που έρχομαι και φεύγω όταν θέλω για να προλάβω το τελευταίο λεωφορείο απόψε',
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
    "Πριν από το μάθημα είπε: «Γύρισα» και «γύρνα» . Θα φύγω πριν από δεκαπέντε χρόνια και πριν από τις δέκα το βράδυ. Ήταν πριν από πολύ καιρό, πριν από τέσσερις δεκαετίες, πριν από κάτι μήνες, πριν από πολλά πολλά χρόνια, πριν από λίγες μέρες και πριν από σχεδόν μισό αιώνα. ανάμεσα στην πόλη και στην θάλασσα, ανάμεσα σε φίλους και στους γείτονες, ανάμεσα σε τη θάλασσα και στις πέτρες σ' το είπα δόξα τω Θεώ που και που έρχομαι και φεύγω όταν θέλω, για να προλάβω το τελευταίο λεωφορείο απόψε",
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

/*
 * This keeps the interrogative toning rule strict enough to skip explanatory,
 * elliptical, and multi-clause openings that happen to end with a Greek
 * question mark but do not use sentence-initial "που" as a plain direct
 * question adverb.
 */
test('question opening toning skips non-direct-question openings', () => {
  const result = applyRules(
    'Που βρίσκουν νερό παρόλο που είμαστε ψηλά σε αυτόν τον λόφο; Που να μας πάρει και να μας σηκώσει, τι στο καλό κάνουμε εδώ πέρα; «Που να σε καταπιούν τα κύματα, τι γκαρίζεις; Που μου έλεγες πως έρχονταν στην Αιώνια Φλόγα και πως έπρεπε να τους εμποδίσουμε, για να μην περάσουν στη Ζουγκλίμνια Πεδιάδα; Που όταν με αντίκρισες θέλησες να με κάνεις δούλα των πολεμιστών σου; Πως γίνεται αυτό;',
    ['question_pou_pos_toning'],
  );

  assert.equal(
    result.text,
    'Πού βρίσκουν νερό παρόλο που είμαστε ψηλά σε αυτόν τον λόφο; Που να μας πάρει και να μας σηκώσει, τι στο καλό κάνουμε εδώ πέρα; «Που να σε καταπιούν τα κύματα, τι γκαρίζεις; Που μου έλεγες πως έρχονταν στην Αιώνια Φλόγα και πως έπρεπε να τους εμποδίσουμε, για να μην περάσουν στη Ζουγκλίμνια Πεδιάδα; Που όταν με αντίκρισες θέλησες να με κάνεις δούλα των πολεμιστών σου; Πώς γίνεται αυτό;',
  );
});

/*
 * These cases lock the new genitive-only grammar heuristics so the fixed
 * prepositional forms are corrected without touching nearby nominal uses.
 */
test('genitive phrase rules normalize λόγω and βάσει only in conservative contexts', () => {
  const result = applyRules(
    'Λόγο της βροχής έφυγα. Άργησε, λογο των έργων, να φτάσει. Με βάση των στοιχείων αποφασίστηκε. Βάση του νόμου ισχύει.',
    ['logo_genitive_normalize', 'vasei_genitive_normalize'],
  );

  assert.equal(
    result.text,
    'Λόγω της βροχής έφυγα. Άργησε, λόγω των έργων, να φτάσει. Βάσει των στοιχείων αποφασίστηκε. Βάσει του νόμου ισχύει.',
  );
});

test('genitive phrase rules skip noun uses of λόγος and βάση', () => {
  const result = applyRules(
    'ο λόγος της απόφασης μετράει. Τον λόγο της μάνας του δεν τον ξέχασε. Η βάση του αγάλματος ράγισε. Στη βάση της σελίδας υπάρχει σημείωση. Με βάση τα στοιχεία προχωράμε. Με βάση αυτό το δεδομένο συνεχίζουμε.',
    ['logo_genitive_normalize', 'vasei_genitive_normalize'],
  );

  assert.equal(
    result.text,
    'ο λόγος της απόφασης μετράει. Τον λόγο της μάνας του δεν τον ξέχασε. Η βάση του αγάλματος ράγισε. Στη βάση της σελίδας υπάρχει σημείωση. Με βάση τα στοιχεία προχωράμε. Με βάση αυτό το δεδομένο συνεχίζουμε.',
  );
});

/*
 * Ellipsis before a closing guillemet should keep the three dots intact; an
 * outside period is added only when the quoted sentence ends there.
 */
test('quote-period preference keeps ellipsis before » and adds outside period only at sentence end', () => {
  const endingSentence = applyRules('Είπε «περίμενε...».', ['quote_period_preference'], {
    preferences: { quotePeriodStyle: 'outside' },
  });
  const continuingSentence = applyRules(
    'Είπε «περίμενε...» και έφυγε.',
    ['quote_period_preference'],
    {
      preferences: { quotePeriodStyle: 'outside' },
    },
  );

  assert.equal(endingSentence.text, 'Είπε «περίμενε...».');
  assert.equal(continuingSentence.text, 'Είπε «περίμενε...» και έφυγε.');
});

test('comma-before-subordinators only changes standalone words and not word fragments', () => {
  const result = applyRules('Ο Γκέχαρντ Μίλερ ήταν χαρούμενος αλλά έφυγε όταν νύχτωσε.', [
    'comma_before_subordinators',
  ]);

  assert.equal(result.text, 'Ο Γκέχαρντ Μίλερ ήταν χαρούμενος αλλά έφυγε όταν νύχτωσε.');
});

test('comma-before-subordinators only affects "για να" and skips other links', () => {
  const result = applyRules(
    'Θα κάτσω λίγο για να τελειώσω τη δύσκολη αναφορά σήμερα. Μίλησα γιατί το ήθελα. Έφυγα επειδή νύχτωσε. Ρώτησε διότι άργησα.',
    ['comma_before_subordinators'],
  );

  assert.equal(
    result.text,
    'Θα κάτσω λίγο, για να τελειώσω τη δύσκολη αναφορά σήμερα. Μίλησα γιατί το ήθελα. Έφυγα επειδή νύχτωσε. Ρώτησε διότι άργησα.',
  );
});

test('comma-before-subordinators skips short "για να" clauses', () => {
  const result = applyRules('Έτρεξα γρήγορα για να σωθώ.', ['comma_before_subordinators']);

  assert.equal(result.text, 'Έτρεξα γρήγορα για να σωθώ.');
});

/*
 * The "ανάμεσα ... και ..." contraction must preserve the leading case pattern
 * of the source sentence while only rewriting the second article family.
 */
test('anamesa article contraction preserves sentence-initial capitalization', () => {
  const result = applyRules('Ανάμεσα στον Ραθ και τον Δημιουργό συγκεκριμένα.', [
    'anamesa_article_contract',
  ]);

  assert.equal(result.text, 'Ανάμεσα στον Ραθ και στον Δημιουργό συγκεκριμένα.');
});

test('comma-before-subordinators does not check "άμα" anymore', () => {
  const result = applyRules('Έμεινα σπίτι άμα έβρεχε πολύ όλη μέρα.', [
    'comma_before_subordinators',
  ]);

  assert.equal(result.text, 'Έμεινα σπίτι άμα έβρεχε πολύ όλη μέρα.');
});

test('comma-before-subordinators does not check "όταν" anymore', () => {
  const result = applyRules('Έφυγα νωρίς όταν άρχισε η δυνατή βροχή.', [
    'comma_before_subordinators',
  ]);

  assert.equal(result.text, 'Έφυγα νωρίς όταν άρχισε η δυνατή βροχή.');
});

test('negation trimming still skips gamma-kappa, mu-pi, and nu-tau digraph starts', () => {
  const result = applyRules(
    'μη γκρινιάζεις μη μπλέξεις μη ντράπηκα μη κλαις μη πάψεις μη τρέξεις μη ψάχνεις μη ανοίγεις',
    ['min_negation_trim'],
  );

  assert.equal(
    result.text,
    'μην γκρινιάζεις μην μπλέξεις μην ντράπηκα μην κλαις μην πάψεις μην τρέξεις μην ψάχνεις μην ανοίγεις',
  );
});

test('min negation rule keeps the fixed phrase "μη αλκοολούχα"', () => {
  const result = applyRules('μη αλκοολούχα ποτά και μη αλκοολούχα μπύρα', ['min_negation_trim']);

  assert.equal(result.text, 'μη αλκοολούχα ποτά και μη αλκοολούχα μπύρα');
});

test('min negation rule keeps the fixed phrase "αν μη τι άλλο"', () => {
  const result = applyRules('αν μη τι άλλο θα φύγω, κι αν μην τι άλλο θα γυρίσω', [
    'min_negation_trim',
  ]);

  assert.equal(result.text, 'αν μη τι άλλο θα φύγω, κι αν μη τι άλλο θα γυρίσω');
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

test('preference rules switch επτά, οκτώ, and εννιά families based on selected preference', () => {
  const result = applyRules(
    'εφτά οχτώ εννέα',
    ['epta_preference', 'okto_preference', 'ennia_preference'],
    {
      preferences: {
        eptaStyle: 'epta',
        oktoStyle: 'okto',
        enniaStyle: 'ennia',
      },
    },
  );

  assert.equal(result.text, 'επτά οκτώ εννιά');
});

test('direct orthography replacements normalize standalone words and phrases', () => {
  const result = applyRules(
    "φώς απο ποιό ποιός ποιά ποιού ποιάς μιά δυό τί πιώ πιείς πιεί πιούν μπάς γιός γιό γιοί γιών ναί θές ωπ ωχ ζήλεια κτήριο εταιρία όσο αναφορά απ' ότι υπόψιν υπ' όψιν συντριβάνι ζάμπλουτος συνοθύλευμα εν τέλη εν μέρη χαχα πω πω πωπωω δεί δείς δούν παρ' όλο που παρόλα αυτά περεπιπτόντως συγνώμη μπύρα ξύδι πάρτυ στυλ ξυπόλητος χρονών φύσησε φύσησαν ξεφύσησε ξεφύσησαν με μιας εξ αρχής οκ σιγά-σιγά χέρι-χέρι χθές χτές προχθές γειά μώβ πρωί βράδυ μέρα νύχτα άψε σβήσε πέρα δώθε",
    [
      'fos_normalize',
      'apo_tonos_normalize',
      'poios_family_tonos_normalize',
      'mia_tonos_normalize',
      'dyo_tonos_normalize',
      'ti_tonos_normalize',
      'pio_family_tonos_normalize',
      'mpas_normalize',
      'gios_family_tonos_normalize',
      'nai_tonos_normalize',
      'thes_tonos_normalize',
      'op_interjection_normalize',
      'och_interjection_normalize',
      'zilia_normalize',
      'ktirio_normalize',
      'etaireia_normalize',
      'oson_afora_normalize',
      'ap_oti_normalize',
      'ypopsi_normalize',
      'sintrivani_normalize',
      'zaploutos_normalize',
      'synonthylevma_normalize',
      'en_telei_normalize',
      'en_merei_normalize',
      'haha_spacing_normalize',
      'popo_normalize',
      'dei_family_tonos_normalize',
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
      'fixed_hyphenated_phrases_normalize',
      'xtes_family_normalize',
      'geia_tonos_normalize',
      'mov_normalize',
      'ok_uppercase',
      'siga_siga_spacing',
      'cheri_cheri_spacing',
    ],
  );

  assert.equal(
    result.text,
    "φως από ποιο ποιος ποια ποιου ποιας μια δυο τι πιω πιεις πιει πιουν μπας γιος γιο γιοι γιων ναι θες οπ οχ ζήλια κτίριο εταιρεία όσον αφορά απ' ό,τι υπόψη υπόψη σιντριβάνι ζάπλουτος συνονθύλευμα εντέλει εν μέρει χα, χα ποπό ποπό δει δεις δουν παρόλο που παρ' όλα αυτά παρεμπιπτόντως συγγνώμη μπίρα ξίδι πάρτι στιλ ξυπόλυτος χρόνων φύσηξε φύσηξαν ξεφύσηξε ξεφύσηξαν μεμιάς εξαρχής ΟΚ σιγά σιγά χέρι χέρι χτες χτες προχτές γεια μοβ πρωί-βράδυ μέρα-νύχτα άψε-σβήσε πέρα-δώθε",
  );
});

test('orthography family rules also normalize the σκεπτικός family', () => {
  const result = applyRules('σκεφτηκός Σκεφτική σκεφτικοί', ['skeptikos_family_normalize']);

  assert.equal(result.text, 'σκεπτικός Σκεπτική σκεπτικοί');
});

test('orthography family rules normalize τρομακτικός family and μυς phrases', () => {
  const result = applyRules('τρομαχτικό τρομαχτική τους μύες οι μυς τους μεγάλους μύες', [
    'tromaktikos_family_normalize',
    'myes_normalize',
  ]);

  assert.equal(result.text, 'τρομακτικό τρομακτική τους μυς οι μύες τους μεγάλους μυς');
});

test('orthography family rules normalize δάχτυλα and νύχτα families', () => {
  const result = applyRules(
    'δάκτυλα δακτυλίδι δακτυλιδιού δακτύλιος δακτυλογραφούσα νύκτα νυκτερινός κρέμα νυκτός',
    ['dachtyla_family_normalize', 'nychta_family_normalize'],
  );

  assert.equal(
    result.text,
    'δάχτυλα δαχτυλίδι δαχτυλιδιού δακτύλιος δακτυλογραφούσα νύχτα νυχτερινός κρέμα νυκτός',
  );
});

test('orthography family rules normalize αντεπεξέρχομαι and απαθανατίζω families', () => {
  const result = applyRules('ανταπεξέρχομαι ανταπεξήλθα αποθανατίζω αποθανατίστηκε', [
    'antepexerxomai_normalize',
    'apathanatizo_normalize',
  ]);

  assert.equal(result.text, 'αντεπεξέρχομαι αντεπεξήλθα απαθανατίζω απαθανατίστηκε');
});

test('orthography family rules normalize νιώθω and δέχτηκα families', () => {
  const result = applyRules('Νοιώθω νοιώσαμε δέχθηκα παραδέχθηκες αποδέχθηκαν', [
    'niotho_family_normalize',
    'dechtika_family_normalize',
  ]);

  assert.equal(result.text, 'Νιώθω νιώσαμε δέχτηκα παραδέχτηκες απόδεχτηκαν');
});

test('orthography family rules normalize the χαιρέτησα family', () => {
  const result = applyRules('χαιρέτισα χαιρέτισες χαιρέτισε χαιρετίσαμε χαιρετίσατε χαιρέτισαν', [
    'chairetisa_family_normalize',
  ]);

  assert.equal(result.text, 'χαιρέτησα χαιρέτησες χαιρέτησε χαιρετήσαμε χαιρετήσατε χαιρέτησαν');
});

test('nobility titles stay capitalized only at sentence start', () => {
  const result = applyRules(
    'Ο Λόρδος μίλησε με τη Βασίλισσα. Λόρδος Αλφρεντ έφυγε. Η Μαρκησία έμεινε.',
    ['nobility_titles_lowercase'],
  );

  assert.equal(
    result.text,
    'Ο λόρδος μίλησε με τη βασίλισσα. Λόρδος Αλφρεντ έφυγε. Η μαρκησία έμεινε.',
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

  assert.throws(
    () =>
      normalizeBooksEditorOptions({
        ruleIds: ['epta_preference'],
        preferences: { eptaStyle: 'invalid' },
      }),
    (error) => error.code === 'INVALID_RULE_PREFERENCE',
  );

  assert.throws(
    () =>
      normalizeBooksEditorOptions({
        ruleIds: ['okto_preference'],
        preferences: { oktoStyle: 'invalid' },
      }),
    (error) => error.code === 'INVALID_RULE_PREFERENCE',
  );

  assert.throws(
    () =>
      normalizeBooksEditorOptions({
        ruleIds: ['ennia_preference'],
        preferences: { enniaStyle: 'invalid' },
      }),
    (error) => error.code === 'INVALID_RULE_PREFERENCE',
  );
});

test('colloquial past progressive rule skips σπάω, σκάω, κλαίω families and fixed excluded words', () => {
  const result = applyRules(
    'έσπαγα το ποτήρι, έσκαγε ο τοίχος, έκλαιγε, διεξήγαγε τη συζήτηση, διεξήγαγα την έρευνα, παρήγαγε έργο, παρήγαγες πολλές ιδέες, αχόρταγα έτρωγε, απήγαγα τον ήρωα και περπάταγα στο δρόμο',
    ['colloquial_past_progressive_normalize'],
  );

  assert.equal(
    result.text,
    'έσπαγα το ποτήρι, έσκαγε ο τοίχος, έκλαιγε, διεξήγαγε τη συζήτηση, διεξήγαγα την έρευνα, παρήγαγε έργο, παρήγαγες πολλές ιδέες, αχόρταγα έτρωγε, απήγαγα τον ήρωα και περπατούσα στο δρόμο',
  );
});
