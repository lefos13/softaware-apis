/*
 * The Books service rewrites only the manuscript body in OOXML, while the
 * same rule engine also powers pasted-text edits and the shared change report.
 */
import { basename } from 'node:path';
import JSZip from 'jszip';
import { XMLBuilder, XMLParser } from 'fast-xml-parser';
import { ApiError } from '../../common/utils/api-error.js';
import { applyGreekEditorRules, normalizeBooksEditorOptions } from './books.rules.js';

const xmlParser = new XMLParser({
  preserveOrder: true,
  ignoreAttributes: false,
  processEntities: false,
  trimValues: false,
});

const xmlBuilder = new XMLBuilder({
  preserveOrder: true,
  ignoreAttributes: false,
  processEntities: false,
  suppressEmptyNode: false,
});

const UNSUPPORTED_PARAGRAPH_CONTAINERS = new Set(['w:txbxContent']);
const MOJIBAKE_GREEK_MARKERS = /[ÎÏÃÐÑ]/;

const readTextNode = (node) =>
  Array.isArray(node?.['w:t'])
    ? node['w:t']
        .filter((child) => Object.hasOwn(child, '#text'))
        .map((child) => child['#text'])
        .join('')
    : '';

const writeTextNode = (node, value) => {
  node['w:t'] = value ? [{ '#text': value }] : [];

  const nextAttributes = {
    ...(node[':@'] || {}),
  };

  if (/^\s|\s$/.test(value)) {
    nextAttributes['@_xml:space'] = 'preserve';
  } else {
    delete nextAttributes['@_xml:space'];
  }

  if (Object.keys(nextAttributes).length > 0) {
    node[':@'] = nextAttributes;
    return;
  }

  delete node[':@'];
};

const findNodeChildren = (nodes, targetName) => {
  for (const node of nodes || []) {
    if (node[targetName]) {
      return node[targetName];
    }

    for (const value of Object.values(node)) {
      if (Array.isArray(value)) {
        const nested = findNodeChildren(value, targetName);
        if (nested) {
          return nested;
        }
      }
    }
  }

  return null;
};

const collectParagraphNodes = (nodes) => {
  const paragraphs = [];

  for (const node of nodes || []) {
    const [nodeName] = Object.keys(node).filter((key) => key !== ':@');
    if (!nodeName) {
      continue;
    }

    if (nodeName === 'w:p') {
      paragraphs.push(node[nodeName]);
      continue;
    }

    if (UNSUPPORTED_PARAGRAPH_CONTAINERS.has(nodeName)) {
      continue;
    }

    const children = node[nodeName];
    if (Array.isArray(children)) {
      paragraphs.push(...collectParagraphNodes(children));
    }
  }

  return paragraphs;
};

const collectParagraphTextNodes = (nodes) => {
  const textNodes = [];

  for (const node of nodes || []) {
    const [nodeName] = Object.keys(node).filter((key) => key !== ':@');
    if (!nodeName) {
      continue;
    }

    if (UNSUPPORTED_PARAGRAPH_CONTAINERS.has(nodeName)) {
      continue;
    }

    if (nodeName === 'w:t') {
      textNodes.push(node);
      continue;
    }

    const children = node[nodeName];
    if (Array.isArray(children)) {
      textNodes.push(...collectParagraphTextNodes(children));
    }
  }

  return textNodes;
};

const buildSegmentLookup = (segments) => {
  const lookup = [];

  segments.forEach((segment, segmentIndex) => {
    for (let index = segment.start; index < segment.end; index += 1) {
      lookup[index] = segmentIndex;
    }
  });

  return lookup;
};

const repairIncomingFileName = (value) => {
  const text = String(value || '');

  if (!MOJIBAKE_GREEK_MARKERS.test(text)) {
    return text;
  }

  try {
    return Buffer.from(text, 'latin1').toString('utf8');
  } catch {
    return text;
  }
};

const stripDocxExtension = (name) => String(name || '').replace(/\.docx$/i, '') || 'manuscript';
const resolveDocxBaseName = (originalName) =>
  stripDocxExtension(basename(repairIncomingFileName(originalName || 'manuscript.docx')));

const buildReplacementSummary = (replacementCounts, extra = {}) => ({
  totalReplacements: Object.values(replacementCounts || {}).reduce((sum, count) => sum + count, 0),
  replacementCounts,
  ...extra,
});

const createReportPayload = ({ inputType, sourceName, editorOptions, summary, changes }) => ({
  generatedAt: new Date().toISOString(),
  inputType,
  sourceName,
  selectedRuleIds: editorOptions.ruleIds,
  preferences: editorOptions.preferences,
  summary,
  changes: changes.map((change, index) => ({
    index: index + 1,
    ...change,
  })),
});

/*
 * The report keeps a readable text version for editors and a JSON version for
 * downstream tooling without re-deriving the same before/after change list.
 */
const formatReportText = (payload) => {
  const lines = [
    'Αναφορά λογοτεχνικής επιμέλειας',
    `Ημερομηνία δημιουργίας: ${payload.generatedAt}`,
    `Τύπος εισόδου: ${payload.inputType === 'docx' ? 'Αρχείο Word' : 'Κείμενο'}`,
    `Αρχείο ή πηγή: ${payload.sourceName || 'text-input'}`,
    `Επιλεγμένοι κανόνες: ${payload.selectedRuleIds.join(', ')}`,
    `Συνολικές αλλαγές: ${payload.summary.totalReplacements}`,
  ];

  if (Number.isFinite(payload.summary.changedParagraphs)) {
    lines.push(`Παράγραφοι που άλλαξαν: ${payload.summary.changedParagraphs}`);
  }

  lines.push('');
  lines.push('Μετρήσεις ανά κανόνα:');
  Object.entries(payload.summary.replacementCounts || {}).forEach(([ruleId, count]) => {
    lines.push(`- ${ruleId}: ${count}`);
  });

  lines.push('');
  lines.push('Αναλυτικές αλλαγές:');

  if (!Array.isArray(payload.changes) || payload.changes.length === 0) {
    lines.push('- Δεν εφαρμόστηκε καμία αλλαγή.');
    return lines.join('\n');
  }

  payload.changes.forEach((change) => {
    lines.push('');
    lines.push(`${change.index}. ${change.ruleId}`);
    if (Number.isFinite(change.paragraphIndex)) {
      lines.push(`Παράγραφος: ${change.paragraphIndex}`);
    }
    lines.push(`Πριν: ${change.before}`);
    lines.push(`Μετά: ${change.after}`);
    lines.push(`Απόσπασμα πριν: ${change.previewBefore}`);
    lines.push(`Απόσπασμα μετά: ${change.previewAfter}`);
    lines.push(`Πρόταση πριν: ${change.sentenceBefore}`);
    lines.push(`Πρόταση μετά: ${change.sentenceAfter}`);
  });

  return lines.join('\n');
};

const buildReportArtifacts = (payload) => ({
  report: payload,
  reportText: formatReportText(payload),
  reportJson: JSON.stringify(payload, null, 2),
});

const buildDocxPackageBuffer = async ({
  editedBuffer,
  editedFileName,
  reportArtifacts,
  baseName,
}) => {
  const zip = new JSZip();
  zip.file(editedFileName, editedBuffer);
  zip.file(`${baseName}-changes-report.txt`, reportArtifacts.reportText);
  zip.file(`${baseName}-changes-report.json`, reportArtifacts.reportJson);

  return zip.generateAsync({ type: 'nodebuffer' });
};

const rewriteParagraphTextNodes = (paragraphNodes, editorOptions, paragraphIndex) => {
  const textNodes = collectParagraphTextNodes(paragraphNodes);
  if (textNodes.length === 0) {
    return {
      changed: false,
      replacementCounts: {},
      totalReplacements: 0,
      changes: [],
    };
  }

  let cursor = 0;
  const segments = textNodes.map((node) => {
    const text = readTextNode(node);
    const segment = {
      node,
      text,
      start: cursor,
      end: cursor + text.length,
    };
    cursor += text.length;
    return segment;
  });

  const originalText = segments.map((segment) => segment.text).join('');
  if (!originalText) {
    return {
      changed: false,
      replacementCounts: {},
      totalReplacements: 0,
      changes: [],
    };
  }

  const rewritten = applyGreekEditorRules(originalText, editorOptions, { paragraphIndex });
  if (rewritten.text === originalText) {
    return {
      changed: false,
      replacementCounts: rewritten.replacementCounts,
      totalReplacements: rewritten.totalReplacements,
      changes: rewritten.changes,
    };
  }

  const buckets = Array.from({ length: segments.length }, () => '');
  const segmentLookup = buildSegmentLookup(segments);

  Array.from(rewritten.text).forEach((char, index) => {
    const anchor = rewritten.sourceMap[index] ?? 0;
    const boundedAnchor = Math.max(0, Math.min(segmentLookup.length - 1, anchor));
    const segmentIndex = segmentLookup[boundedAnchor] ?? 0;
    buckets[segmentIndex] += char;
  });

  segments.forEach((segment, index) => {
    writeTextNode(segment.node, buckets[index] || '');
  });

  return {
    changed: true,
    replacementCounts: rewritten.replacementCounts,
    totalReplacements: rewritten.totalReplacements,
    changes: rewritten.changes,
  };
};

const mergeReplacementCounts = (target, next) => {
  Object.entries(next || {}).forEach(([ruleId, count]) => {
    target[ruleId] = (target[ruleId] || 0) + count;
  });
};

export async function applyGreekEditorToText(inputText, rawEditorOptions, onProgress) {
  const editorOptions = normalizeBooksEditorOptions(rawEditorOptions);
  const normalizedText = String(inputText || '');

  if (!normalizedText.trim()) {
    throw new ApiError(400, 'INVALID_TEXT_INPUT', 'inputText must contain editable text', {
      details: [{ field: 'inputText', issue: 'Provide text in the request body' }],
    });
  }

  onProgress?.({
    progress: 20,
    step: 'Preparing text input',
    metadata: { selectedRuleIds: editorOptions.ruleIds },
  });

  const rewritten = applyGreekEditorRules(normalizedText, editorOptions);

  onProgress?.({
    progress: 75,
    step: 'Applying Greek editor rules to text',
    metadata: { totalReplacements: rewritten.totalReplacements },
  });

  const summary = buildReplacementSummary(rewritten.replacementCounts);
  const reportArtifacts = editorOptions.includeReport
    ? buildReportArtifacts(
        createReportPayload({
          inputType: 'text',
          sourceName: 'text-input',
          editorOptions,
          summary,
          changes: rewritten.changes,
        }),
      )
    : null;

  onProgress?.({
    progress: 96,
    step: 'Corrected text ready',
    metadata: summary,
  });

  return {
    correctedText: rewritten.text,
    summary,
    report: reportArtifacts?.report || null,
    reportText: reportArtifacts?.reportText || '',
  };
}

export async function applyGreekEditorToDocxBuffer(file, rawEditorOptions, onProgress) {
  const editorOptions = normalizeBooksEditorOptions(rawEditorOptions);
  const baseName = resolveDocxBaseName(file.originalname);
  const editedFileName = `${baseName}-edited.docx`;

  onProgress?.({
    progress: 18,
    step: 'Loading DOCX package',
    metadata: { selectedRuleIds: editorOptions.ruleIds },
  });

  let zip;
  try {
    zip = await JSZip.loadAsync(file.buffer);
  } catch (error) {
    throw new ApiError(422, 'CORRUPT_DOCX', 'Uploaded DOCX file could not be opened', {
      details: [{ field: 'files', issue: 'The DOCX ZIP package is invalid or corrupted' }],
      cause: error,
    });
  }

  const documentFile = zip.file('word/document.xml');
  if (!documentFile) {
    throw new ApiError(422, 'UNSUPPORTED_DOCX_STRUCTURE', 'DOCX is missing word/document.xml', {
      details: [{ field: 'files', issue: 'The DOCX structure is not supported in this editor' }],
    });
  }

  onProgress?.({
    progress: 38,
    step: 'Parsing manuscript text',
  });

  let xmlText;
  let parsedDocument;
  try {
    xmlText = await documentFile.async('string');
    parsedDocument = xmlParser.parse(xmlText);
  } catch (error) {
    throw new ApiError(422, 'CORRUPT_DOCX', 'DOCX XML content could not be parsed', {
      details: [{ field: 'files', issue: 'The Word document XML is invalid' }],
      cause: error,
    });
  }

  const bodyNodes = findNodeChildren(parsedDocument, 'w:body');
  if (!bodyNodes) {
    throw new ApiError(422, 'UNSUPPORTED_DOCX_STRUCTURE', 'DOCX body content is missing', {
      details: [{ field: 'files', issue: 'The document body could not be located' }],
    });
  }

  const paragraphs = collectParagraphNodes(bodyNodes);
  if (paragraphs.length === 0) {
    throw new ApiError(422, 'UNSUPPORTED_DOCX_STRUCTURE', 'DOCX has no editable body paragraphs', {
      details: [{ field: 'files', issue: 'The document body has no supported text paragraphs' }],
    });
  }

  onProgress?.({
    progress: 58,
    step: 'Applying Greek editor rules',
    metadata: { paragraphCount: paragraphs.length },
  });

  const replacementCounts = {};
  const changes = [];
  let changedParagraphs = 0;
  let totalReplacements = 0;

  paragraphs.forEach((paragraphNodes, index) => {
    const result = rewriteParagraphTextNodes(paragraphNodes, editorOptions, index + 1);
    if (result.changed) {
      changedParagraphs += 1;
    }

    totalReplacements += result.totalReplacements || 0;
    changes.push(...(result.changes || []));
    mergeReplacementCounts(replacementCounts, result.replacementCounts);
  });

  const summary = buildReplacementSummary(replacementCounts, { changedParagraphs });

  onProgress?.({
    progress: 82,
    step: editorOptions.includeReport
      ? 'Building corrected manuscript and report'
      : 'Building corrected DOCX',
    metadata: {
      changedParagraphs,
      totalReplacements,
      replacementCounts,
    },
  });

  const nextDocumentXml = xmlBuilder.build(parsedDocument);
  zip.file('word/document.xml', nextDocumentXml);

  const editedBuffer = await zip.generateAsync({ type: 'nodebuffer' });
  const reportArtifacts = editorOptions.includeReport
    ? buildReportArtifacts(
        createReportPayload({
          inputType: 'docx',
          sourceName: repairIncomingFileName(file.originalname || 'manuscript.docx'),
          editorOptions,
          summary,
          changes,
        }),
      )
    : null;
  const buffer = editorOptions.includeReport
    ? await buildDocxPackageBuffer({
        editedBuffer,
        editedFileName,
        reportArtifacts,
        baseName,
      })
    : editedBuffer;

  onProgress?.({
    progress: 96,
    step: editorOptions.includeReport
      ? 'Corrected manuscript package ready'
      : 'Corrected DOCX ready',
    metadata: {
      changedParagraphs,
      totalReplacements,
      replacementCounts,
      outputFileName: editorOptions.includeReport
        ? `${baseName}-edited-package.zip`
        : editedFileName,
    },
  });

  return {
    buffer,
    summary,
    report: reportArtifacts?.report || null,
    reportText: reportArtifacts?.reportText || '',
    outputKind: editorOptions.includeReport ? 'zip' : 'docx',
    editedFileName,
  };
}

export async function previewGreekEditorDocxReport(file, rawEditorOptions, onProgress) {
  const result = await applyGreekEditorToDocxBuffer(
    file,
    { ...rawEditorOptions, includeReport: true },
    onProgress,
  );

  return {
    summary: result.summary,
    report: result.report,
    reportText: result.reportText,
  };
}
