/*
 * Controller tests verify both binary and JSON Books responses without
 * relying on a listening socket, which keeps the backend tests sandbox-safe.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { initializeTaskProgress } from '../../common/middleware/task-context.js';
import {
  applyGreekEditorController,
  applyGreekEditorTextController,
  previewGreekEditorReportController,
} from './books.controller.js';

const createDocxBuffer = async (text = 'και αγάπη') => {
  const zip = new JSZip();
  zip.file(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
    <Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
      <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
      <Default Extension="xml" ContentType="application/xml"/>
      <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
    </Types>`,
  );
  zip.folder('_rels')?.file(
    '.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
    <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
      <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
    </Relationships>`,
  );
  zip.folder('word')?.file(
    'document.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
    <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
      <w:body>
        <w:p><w:r><w:t>${text}</w:t></w:r></w:p>
      </w:body>
    </w:document>`,
  );

  return zip.generateAsync({ type: 'nodebuffer' });
};

const createResponseMock = () => {
  const headers = new Map();
  const response = {
    statusCode: 200,
    body: null,
    setHeader(name, value) {
      headers.set(String(name).toLowerCase(), value);
    },
    getHeader(name) {
      return headers.get(String(name).toLowerCase());
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    send(payload) {
      this.body = payload;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };

  return response;
};

const createRequestMock = async (
  editorOptions = { ruleIds: ['kai_before_vowel'] },
  originalname = 'manuscript.docx',
) => ({
  query: { taskId: 'books-task-1' },
  body: {
    editorOptions: JSON.stringify(editorOptions),
  },
  files: [
    {
      originalname,
      size: 1024,
      buffer: await createDocxBuffer(),
      mimetype: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    },
  ],
  get: () => '',
});

test('applyGreekEditorController returns a DOCX download with task metadata', async () => {
  const req = await createRequestMock();
  const res = createResponseMock();
  let forwardedError = null;

  await new Promise((resolve) => {
    initializeTaskProgress('books_greek_editor_apply')(req, res, resolve);
  });

  await applyGreekEditorController(req, res, (error) => {
    forwardedError = error;
  });

  assert.equal(forwardedError, null);
  assert.equal(res.statusCode, 200);
  assert.equal(
    res.getHeader('content-type'),
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  );
  assert.equal(res.getHeader('x-task-id'), 'books-task-1');
  assert.equal(
    res.getHeader('x-operation-message'),
    'Greek literature corrections applied successfully',
  );
  assert.match(res.getHeader('content-disposition') || '', /filename="manuscript-edited\.docx"/);
  assert.match(
    res.getHeader('content-disposition') || '',
    /filename\*=UTF-8''manuscript-edited\.docx/,
  );
  assert.ok(Buffer.isBuffer(res.body));
});

test('applyGreekEditorController returns a ZIP package when report output is requested', async () => {
  const req = await createRequestMock({ ruleIds: ['kai_before_vowel'], includeReport: true });
  const res = createResponseMock();
  let forwardedError = null;

  await new Promise((resolve) => {
    initializeTaskProgress('books_greek_editor_apply')(req, res, resolve);
  });

  await applyGreekEditorController(req, res, (error) => {
    forwardedError = error;
  });

  assert.equal(forwardedError, null);
  assert.equal(res.getHeader('content-type'), 'application/zip');
  assert.match(
    res.getHeader('content-disposition') || '',
    /filename="manuscript-edited-package\.zip"/,
  );
});

test('applyGreekEditorController repairs mojibake upload names before setting Content-Disposition', async () => {
  const req = await createRequestMock(
    { ruleIds: ['kai_before_vowel'] },
    'Î¤Î Î ÎÎ Î¡Î©ÎÎÎÎ Î¤ÎÎ¥ Î¡ÎÎ - ÎÎ»Î¿ÎºÎ»Î·ÏÏÎ¼ÎµÌÎ½Î¿.docx',
  );
  const res = createResponseMock();
  let forwardedError = null;

  await new Promise((resolve) => {
    initializeTaskProgress('books_greek_editor_apply')(req, res, resolve);
  });

  await applyGreekEditorController(req, res, (error) => {
    forwardedError = error;
  });

  assert.equal(forwardedError, null);
  assert.match(
    res.getHeader('content-disposition') || '',
    /filename\*=UTF-8''%CE%A4%CE%9F%20%CE%A0%CE%95%CE%A0%CE%A1%CE%A9%CE%9C%CE%95%CE%9D%CE%9F%20%CE%A4%CE%9F%CE%A5%20%CE%A1%CE%91%CE%98%20-%20%CE%9F%CE%BB%CE%BF%CE%BA%CE%BB%CE%B7%CF%81%CF%89%CE%BC%CE%B5%CC%81%CE%BD%CE%BF-edited\.docx/,
  );
});

test('applyGreekEditorController forwards empty rule selections as API errors', async () => {
  const req = await createRequestMock({ ruleIds: [] });
  const res = createResponseMock();
  let forwardedError = null;

  await applyGreekEditorController(req, res, (error) => {
    forwardedError = error;
  });

  assert.equal(res.body, null);
  assert.equal(forwardedError.code, 'EMPTY_RULE_SELECTION');
});

test('applyGreekEditorController forwards unknown rule ids as API errors', async () => {
  const req = await createRequestMock({ ruleIds: ['unknown_rule'] });
  const res = createResponseMock();
  let forwardedError = null;

  await applyGreekEditorController(req, res, (error) => {
    forwardedError = error;
  });

  assert.equal(res.body, null);
  assert.equal(forwardedError.code, 'INVALID_RULE_ID');
});

test('applyGreekEditorTextController returns corrected text and report data', async () => {
  const req = {
    query: { taskId: 'books-task-text-1' },
    body: {
      inputText: 'σα λύκος.....',
      editorOptions: {
        ruleIds: ['sa_to_san', 'ellipsis_normalize'],
        includeReport: true,
      },
    },
    get: () => '',
  };
  const res = createResponseMock();
  let forwardedError = null;

  await new Promise((resolve) => {
    initializeTaskProgress('books_greek_editor_apply_text')(req, res, resolve);
  });

  await applyGreekEditorTextController(req, res, (error) => {
    forwardedError = error;
  });

  assert.equal(forwardedError, null);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.data.correctedText, 'σαν λύκος...');
  assert.match(res.body.data.reportText, /Αναλυτικές αλλαγές:/);
});

test('previewGreekEditorReportController returns JSON report preview for DOCX uploads', async () => {
  const req = await createRequestMock({ ruleIds: ['kai_before_vowel'], includeReport: true });
  const res = createResponseMock();
  let forwardedError = null;

  await new Promise((resolve) => {
    initializeTaskProgress('books_greek_editor_preview_report')(req, res, resolve);
  });

  await previewGreekEditorReportController(req, res, (error) => {
    forwardedError = error;
  });

  assert.equal(forwardedError, null);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.ok(res.body.data.report);
  assert.match(res.body.data.reportText, /Αναφορά λογοτεχνικής επιμέλειας/);
});
