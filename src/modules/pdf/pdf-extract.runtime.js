/**
 * Why this exists: OCR extraction depends on system binaries, so runtime checks
 * are centralized for startup warnings and request-time guardrails.
 */
import { spawnSync } from 'node:child_process';

const RUNTIME_DEPS = [
  {
    command: 'tesseract',
    args: ['--version'],
    displayName: 'Tesseract OCR',
  },
  {
    command: 'pdftoppm',
    args: ['-v'],
    displayName: 'Poppler pdftoppm',
  },
];

const isCommandAvailable = ({ command, args }) => {
  const probe = spawnSync(command, args, { stdio: 'ignore' });
  return probe.status === 0;
};

export const inspectPdfExtractRuntimeDependencies = () => {
  const missing = RUNTIME_DEPS.filter((dependency) => !isCommandAvailable(dependency));

  return {
    available: missing.length === 0,
    missing,
  };
};
