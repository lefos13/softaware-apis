/*
  DOCX service tests build minimal OOXML packages so the editor can be
  verified without relying on checked-in Word documents or external tooling.
*/
import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { XMLParser } from 'fast-xml-parser';
import { applyGreekEditorToDocxBuffer } from './books.service.js';

const xmlParser = new XMLParser({
  preserveOrder: true,
  ignoreAttributes: false,
  processEntities: false,
  trimValues: false,
});

const createDocxBuffer = async ({
  documentXml,
  headerXml = '<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:r><w:t>HEADER TEXT</w:t></w:r></w:p></w:hdr>',
} = {}) => {
  const zip = new JSZip();
  zip.file(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
    <Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
      <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
      <Default Extension="xml" ContentType="application/xml"/>
      <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
      <Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>
    </Types>`,
  );
  zip.folder('_rels')?.file(
    '.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
    <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
      <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
    </Relationships>`,
  );
  zip.folder('word')?.file('document.xml', documentXml);
  zip.folder('word')?.file('header1.xml', headerXml);
  zip
    .folder('word')
    ?.folder('_rels')
    ?.file(
      'document.xml.rels',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
    <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
      <Relationship Id="rIdHeader1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/>
    </Relationships>`,
    );

  return zip.generateAsync({ type: 'nodebuffer' });
};

const readZipXml = async (buffer, path) => {
  const zip = await JSZip.loadAsync(buffer);
  return zip.file(path).async('string');
};

test('applyGreekEditorToDocxBuffer rewrites only word/document.xml and supports run-spanning matches', async () => {
  const inputBuffer = await createDocxBuffer({
    documentXml: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
      <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
        <w:body>
          <w:p>
            <w:r><w:t>κα</w:t></w:r>
            <w:r><w:t>ι αγάπη</w:t></w:r>
          </w:p>
          <w:p>
            <w:r><w:t>σα λύκος.....</w:t></w:r>
          </w:p>
        </w:body>
      </w:document>`,
  });

  const result = await applyGreekEditorToDocxBuffer(
    {
      buffer: inputBuffer,
      originalname: 'book.docx',
    },
    {
      ruleIds: ['kai_before_vowel', 'sa_to_san', 'ellipsis_normalize'],
    },
  );

  const documentXml = await readZipXml(result.buffer, 'word/document.xml');
  const headerXml = await readZipXml(result.buffer, 'word/header1.xml');

  assert.match(documentXml, /<w:t>κι<\/w:t>/);
  assert.match(documentXml, /xml:space="preserve"> αγάπη<\/w:t>/);
  assert.match(documentXml, /σαν λύκος\.\.\./);
  assert.match(headerXml, /HEADER TEXT/);
  assert.equal(result.summary.totalReplacements, 3);
});

test('applyGreekEditorToDocxBuffer rejects invalid ZIP payloads', async () => {
  await assert.rejects(
    () =>
      applyGreekEditorToDocxBuffer(
        {
          buffer: Buffer.from('not-a-docx'),
          originalname: 'broken.docx',
        },
        { ruleIds: ['sa_to_san'] },
      ),
    (error) => error.code === 'CORRUPT_DOCX',
  );
});

test('applyGreekEditorToDocxBuffer rejects DOCX packages without word/document.xml', async () => {
  const zip = new JSZip();
  zip.file(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
    <Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"></Types>`,
  );

  const buffer = await zip.generateAsync({ type: 'nodebuffer' });

  await assert.rejects(
    () =>
      applyGreekEditorToDocxBuffer(
        {
          buffer,
          originalname: 'missing-document.docx',
        },
        { ruleIds: ['sa_to_san'] },
      ),
    (error) => error.code === 'UNSUPPORTED_DOCX_STRUCTURE',
  );
});

test('service output remains parseable OOXML after edits', async () => {
  const inputBuffer = await createDocxBuffer({
    documentXml: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
      <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
        <w:body>
          <w:p><w:r><w:t>στην βροχή</w:t></w:r></w:p>
        </w:body>
      </w:document>`,
  });

  const result = await applyGreekEditorToDocxBuffer(
    {
      buffer: inputBuffer,
      originalname: 'parseable.docx',
    },
    { ruleIds: ['stin_article_trim'] },
  );

  const documentXml = await readZipXml(result.buffer, 'word/document.xml');
  const parsed = xmlParser.parse(documentXml);

  assert.ok(Array.isArray(parsed));
  assert.match(documentXml, /στη βροχή/);
});

test('applyGreekEditorToDocxBuffer preserves spaces around italic and proofing markup runs', async () => {
  const inputBuffer = await createDocxBuffer({
    documentXml: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
      <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
        <w:body>
          <w:p>
            <w:r><w:t xml:space="preserve">Λέξη </w:t></w:r>
            <w:proofErr w:type="spellStart"/>
            <w:r>
              <w:rPr><w:i/></w:rPr>
              <w:t>και</w:t>
            </w:r>
            <w:proofErr w:type="spellEnd"/>
            <w:r><w:t xml:space="preserve"> αγάπη</w:t></w:r>
          </w:p>
        </w:body>
      </w:document>`,
  });

  const result = await applyGreekEditorToDocxBuffer(
    {
      buffer: inputBuffer,
      originalname: 'italic-proofing.docx',
    },
    { ruleIds: ['kai_before_vowel'] },
  );

  const documentXml = await readZipXml(result.buffer, 'word/document.xml');

  assert.match(documentXml, /xml:space="preserve">Λέξη <\/w:t>/);
  assert.match(documentXml, /<w:t>κι<\/w:t>/);
  assert.match(documentXml, /xml:space="preserve"> αγάπη<\/w:t>/);
});
