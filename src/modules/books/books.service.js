/**
 * Why this exists: the DOCX editor needs to rewrite only the manuscript text
 * in `word/document.xml` while keeping the rest of the OOXML package intact.
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

const rewriteParagraphTextNodes = (paragraphNodes, ruleIds) => {
  const textNodes = collectParagraphTextNodes(paragraphNodes);
  if (textNodes.length === 0) {
    return {
      changed: false,
      replacementCounts: {},
      totalReplacements: 0,
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
    };
  }

  const rewritten = applyGreekEditorRules(originalText, ruleIds);
  if (rewritten.text === originalText) {
    return {
      changed: false,
      replacementCounts: rewritten.replacementCounts,
      totalReplacements: rewritten.totalReplacements,
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
  };
};

const mergeReplacementCounts = (target, next) => {
  Object.entries(next || {}).forEach(([ruleId, count]) => {
    target[ruleId] = (target[ruleId] || 0) + count;
  });
};

const stripDocxExtension = (name) => String(name || '').replace(/\.docx$/i, '') || 'manuscript';

export async function applyGreekEditorToDocxBuffer(file, rawEditorOptions, onProgress) {
  const editorOptions = normalizeBooksEditorOptions(rawEditorOptions);
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
      details: [{ field: 'files', issue: 'The DOCX structure is not supported in v1' }],
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
    step: 'Applying Greek literature rules',
    metadata: { paragraphCount: paragraphs.length },
  });

  const replacementCounts = {};
  let changedParagraphs = 0;
  let totalReplacements = 0;

  paragraphs.forEach((paragraphNodes) => {
    const result = rewriteParagraphTextNodes(paragraphNodes, editorOptions.ruleIds);
    if (result.changed) {
      changedParagraphs += 1;
    }

    totalReplacements += result.totalReplacements || 0;
    mergeReplacementCounts(replacementCounts, result.replacementCounts);
  });

  onProgress?.({
    progress: 82,
    step: 'Building corrected DOCX',
    metadata: {
      changedParagraphs,
      totalReplacements,
      replacementCounts,
    },
  });

  const nextDocumentXml = xmlBuilder.build(parsedDocument);
  zip.file('word/document.xml', nextDocumentXml);

  const buffer = await zip.generateAsync({ type: 'nodebuffer' });

  onProgress?.({
    progress: 96,
    step: 'Corrected DOCX ready',
    metadata: {
      changedParagraphs,
      totalReplacements,
      replacementCounts,
      outputFileName: `${stripDocxExtension(basename(file.originalname || 'manuscript.docx'))}-edited.docx`,
    },
  });

  return {
    buffer,
    summary: {
      changedParagraphs,
      totalReplacements,
      replacementCounts,
    },
  };
}
