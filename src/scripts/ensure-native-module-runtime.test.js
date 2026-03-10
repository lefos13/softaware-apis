/*
 * The native runtime guard must distinguish real better-sqlite3 ABI mismatches
 * from unrelated startup failures so dev boot only rebuilds when the addon
 * was compiled against a different Node module version.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isNativeModuleVersionMismatchError,
  resolveRebuildInvocation,
} from './ensure-native-module-runtime.js';

test('detects better-sqlite3 ABI mismatch errors', () => {
  const error = new Error(
    "The module 'better_sqlite3.node' was compiled against a different Node.js version using NODE_MODULE_VERSION 141.",
  );

  assert.equal(isNativeModuleVersionMismatchError(error), true);
});

test('ignores unrelated startup errors', () => {
  const error = new Error('listen EADDRINUSE: address already in use 0.0.0.0:3000');

  assert.equal(isNativeModuleVersionMismatchError(error), false);
});

test('prefers npm_execpath so rebuild uses the current npm runtime', () => {
  const originalExecPath = process.env.npm_execpath;
  process.env.npm_execpath = '/tmp/npm-cli.js';

  try {
    assert.deepEqual(resolveRebuildInvocation(), {
      command: process.execPath,
      args: ['/tmp/npm-cli.js', 'rebuild', 'better-sqlite3'],
    });
  } finally {
    if (originalExecPath === undefined) {
      delete process.env.npm_execpath;
    } else {
      process.env.npm_execpath = originalExecPath;
    }
  }
});
