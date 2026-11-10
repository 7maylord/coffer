import { readdir, readFile } from 'node:fs/promises';
import { dirname, extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const ignoredDirectories = new Set([
  '.git',
  '.next',
  'coverage',
  'dist',
  'node_modules',
  'target',
]);
const scannedExtensions = new Set([
  '.cjs',
  '.js',
  '.json',
  '.jsx',
  '.md',
  '.mjs',
  '.rs',
  '.toml',
  '.ts',
  '.tsx',
  '.yaml',
  '.yml',
]);
const ignoredFiles = new Set([
  'pnpm-lock.yaml',
  'Cargo.lock',
  'security-scan.mjs',
]);

const credentialMarkers = [
  ['private-key-pem', /-----BEGIN (?:EC |RSA |OPENSSH )?PRIVATE KEY-----/],
  ['near-secret-key', /ed25519:[1-9A-HJ-NP-Za-km-z]{80,}/],
  ['aws-access-key', /AKIA[0-9A-Z]{16}/],
  ['github-token', /gh[pousr]_[A-Za-z0-9]{36,}/],
  ['openai-secret-key', /sk-(?:proj-)?[A-Za-z0-9_-]{32,}/],
  ['stripe-secret-key', /sk_(?:live|test)_[A-Za-z0-9]{24,}/],
];

async function collectFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      if (entry.isDirectory()) {
        if (
          ignoredDirectories.has(entry.name) ||
          entry.name.startsWith('.next-')
        )
          return [];
        return collectFiles(join(directory, entry.name));
      }
      if (
        !entry.isFile() ||
        ignoredFiles.has(entry.name) ||
        !scannedExtensions.has(extname(entry.name))
      ) {
        return [];
      }
      return [join(directory, entry.name)];
    }),
  );
  return nested.flat();
}

const files = await collectFiles(repositoryRoot);
const findings = [];
for (const file of files) {
  const contents = await readFile(file, 'utf8');
  for (const [code, pattern] of credentialMarkers) {
    if (pattern.test(contents)) {
      findings.push(`${relative(repositoryRoot, file)}: ${code}`);
    }
  }
}

if (findings.length > 0) {
  console.error('Potential credential material found (values are not printed):');
  for (const finding of findings) console.error(`- ${finding}`);
  process.exitCode = 1;
} else {
  console.log(`Credential marker scan passed for ${files.length} source files.`);
}
