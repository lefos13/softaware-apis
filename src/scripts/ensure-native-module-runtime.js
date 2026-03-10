/*
 * Native addons such as better-sqlite3 are compiled per Node ABI version.
 * When the repo is installed or deployed under one Node version and then run
 * under another, the server crashes before boot. This script detects that
 * mismatch and rebuilds the addon with the current runtime automatically.
 */
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';

const require = createRequire(import.meta.url);

export const isNativeModuleVersionMismatchError = (error) => {
  const text = String(error?.stack || error?.message || error || '');
  return (
    text.includes('better_sqlite3.node') &&
    (text.includes('NODE_MODULE_VERSION') ||
      text.includes('was compiled against a different Node.js version'))
  );
};

export const resolveRebuildInvocation = () => {
  const npmExecPath = String(process.env.npm_execpath || '').trim();
  if (npmExecPath) {
    return {
      command: process.execPath,
      args: [npmExecPath, 'rebuild', 'better-sqlite3'],
    };
  }

  return {
    command: 'npm',
    args: ['rebuild', 'better-sqlite3'],
  };
};

const verifyNativeModule = () => {
  require('better-sqlite3');
};

export const ensureNativeModuleRuntime = () => {
  try {
    verifyNativeModule();
    return { rebuilt: false };
  } catch (error) {
    if (!isNativeModuleVersionMismatchError(error)) {
      throw error;
    }

    const invocation = resolveRebuildInvocation();
    console.warn(
      `[softaware-apis] better-sqlite3 ABI mismatch detected for Node ${process.version}; rebuilding native module...`,
    );

    const result = spawnSync(invocation.command, invocation.args, {
      stdio: 'inherit',
      env: process.env,
    });

    if (result.status !== 0) {
      throw new Error('better-sqlite3 rebuild failed');
    }

    verifyNativeModule();
    return { rebuilt: true };
  }
};

if (import.meta.url === new URL(process.argv[1], 'file:').href) {
  ensureNativeModuleRuntime();
}
