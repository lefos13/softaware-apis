/*
  Upload filter tests protect the DOCX-only contract before controller logic
  runs, keeping unsupported files out of the Greek editor flow.
*/
import test from 'node:test';
import assert from 'node:assert/strict';
import { booksDocxFileFilter } from './books.upload.js';

test('booksDocxFileFilter accepts DOCX uploads by extension', async () => {
  await new Promise((resolve, reject) => {
    booksDocxFileFilter(
      {},
      {
        originalname: 'book.docx',
        mimetype: 'application/octet-stream',
      },
      (error, accepted) => {
        try {
          assert.equal(error, null);
          assert.equal(accepted, true);
          resolve();
        } catch (assertionError) {
          reject(assertionError);
        }
      },
    );
  });
});

test('booksDocxFileFilter rejects unsupported file types', async () => {
  await new Promise((resolve, reject) => {
    booksDocxFileFilter(
      {},
      {
        originalname: 'notes.txt',
        mimetype: 'text/plain',
      },
      (error) => {
        try {
          assert.equal(error.code, 'UNSUPPORTED_FILE_TYPE');
          resolve();
        } catch (assertionError) {
          reject(assertionError);
        }
      },
    );
  });
});
