/**
 * Why this exists: PDF-to-DOCX extraction requires native OCR binaries, so
 * setup/start scripts must verify (and optionally install) dependencies.
 */
import { spawnSync } from 'node:child_process';
import process from 'node:process';

const REQUIRED_COMMANDS = [
  {
    name: 'tesseract',
    command: 'tesseract',
    args: ['--version'],
    installHint: 'Install Tesseract OCR',
  },
  {
    name: 'pdftoppm',
    command: 'pdftoppm',
    args: ['-v'],
    installHint: 'Install Poppler (pdftoppm)',
  },
];

const REQUIRED_LANGUAGES = ['eng', 'ell'];

const parseBoolean = (value, fallback) => {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }

  const normalized = String(value).trim().toLowerCase();

  if (['true', '1', 'yes', 'y', 'on'].includes(normalized)) {
    return true;
  }

  if (['false', '0', 'no', 'n', 'off'].includes(normalized)) {
    return false;
  }

  return fallback;
};

const run = (command, args, options = {}) => {
  return spawnSync(command, args, {
    stdio: options.captureOutput ? 'pipe' : 'inherit',
    encoding: 'utf8',
    env: process.env,
  });
};

const isCommandAvailable = ({ command, args }) => {
  const probe = run(command, args, { captureOutput: true });
  return probe.status === 0;
};

const getInstalledLanguages = () => {
  const probe = run('tesseract', ['--list-langs'], { captureOutput: true });

  if (probe.status !== 0) {
    return new Set();
  }

  const lines = String(probe.stdout || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !line.startsWith('List of available languages'));

  return new Set(lines);
};

const detectInstaller = () => {
  const hasBrew = run('brew', ['--version'], { captureOutput: true }).status === 0;
  if (process.platform === 'darwin' && hasBrew) {
    return {
      id: 'brew',
      installCommands: [['brew', ['install', 'tesseract', 'poppler', 'tesseract-lang']]],
      manualHint: 'brew install tesseract poppler tesseract-lang',
    };
  }

  const hasApt = run('apt-get', ['--version'], { captureOutput: true }).status === 0;
  if (process.platform === 'linux' && hasApt) {
    return {
      id: 'apt',
      installCommands: [
        ['sudo', ['apt-get', 'update']],
        [
          'sudo',
          ['apt-get', 'install', '-y', 'tesseract-ocr', 'tesseract-ocr-ell', 'poppler-utils'],
        ],
      ],
      manualHint:
        'sudo apt-get update && sudo apt-get install -y tesseract-ocr tesseract-ocr-ell poppler-utils',
    };
  }

  return null;
};

const printMissing = ({ missingCommands, missingLanguages }) => {
  if (missingCommands.length > 0) {
    console.error('[softaware-apis] Missing OCR binaries:');
    missingCommands.forEach((item) => {
      console.error(`- ${item.command}: ${item.installHint}`);
    });
  }

  if (missingLanguages.length > 0) {
    console.error('[softaware-apis] Missing Tesseract language packs:');
    missingLanguages.forEach((language) => {
      console.error(`- ${language}`);
    });
  }
};

const runInstaller = (installer) => {
  console.log(`[softaware-apis] Installing OCR runtime via ${installer.id}...`);

  for (const [command, args] of installer.installCommands) {
    const result = run(command, args);

    if (result.status !== 0) {
      console.error(`[softaware-apis] Install step failed: ${command} ${args.join(' ')}`);
      process.exit(1);
    }
  }
};

const isFeatureEnabled = parseBoolean(process.env.PDF_EXTRACT_TO_DOCX_ENABLED, true);
if (!isFeatureEnabled) {
  console.log('[softaware-apis] OCR runtime check skipped (PDF_EXTRACT_TO_DOCX_ENABLED=false).');
  process.exit(0);
}

const shouldInstall = process.argv.includes('--install');

const evaluateRuntime = () => {
  const missingCommands = REQUIRED_COMMANDS.filter((dependency) => !isCommandAvailable(dependency));
  const installedLanguages = getInstalledLanguages();
  const missingLanguages = REQUIRED_LANGUAGES.filter(
    (language) => !installedLanguages.has(language),
  );

  return {
    missingCommands,
    missingLanguages,
  };
};

let runtime = evaluateRuntime();

if (runtime.missingCommands.length === 0 && runtime.missingLanguages.length === 0) {
  console.log('[softaware-apis] OCR runtime is ready (tesseract + pdftoppm + eng/ell).');
  process.exit(0);
}

if (shouldInstall) {
  const installer = detectInstaller();

  if (!installer) {
    console.error('[softaware-apis] No supported installer detected for automatic OCR setup.');
    printMissing(runtime);
    console.error('[softaware-apis] Install manually, then rerun: npm run runtime:check');
    process.exit(1);
  }

  runInstaller(installer);
  runtime = evaluateRuntime();

  if (runtime.missingCommands.length === 0 && runtime.missingLanguages.length === 0) {
    console.log('[softaware-apis] OCR runtime install completed successfully.');
    process.exit(0);
  }

  console.error(
    '[softaware-apis] OCR runtime install completed but some dependencies are still missing.',
  );
  printMissing(runtime);
  console.error('[softaware-apis] Try manual install:');
  console.error(installer.manualHint);
  process.exit(1);
}

printMissing(runtime);

const installer = detectInstaller();
if (installer) {
  console.error('[softaware-apis] Install automatically with: npm run runtime:install');
  console.error(`[softaware-apis] Manual command: ${installer.manualHint}`);
} else {
  console.error('[softaware-apis] Install required OCR dependencies manually for your platform.');
}

process.exit(1);
