/** Rebuild bundled third-party notices from the pinned native tree and installed lockfile. */
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const native = resolve(root, 'android/third_party/llama.cpp');
const output = resolve(root, 'public/licenses');
await mkdir(output, { recursive: true });

const vendors = [
  ['xxHash', 'vendor/hash/xxhash/LICENSE'],
  ['SHA-256', 'vendor/hash/sha256/LICENSE'],
  ['rotate-bits', 'vendor/hash/rotate-bits/LICENSE.md'],
  ['nlohmann JSON', 'licenses/LICENSE-jsonhpp'],
];
const texts = [];
for (const [name, path] of vendors) texts.push(`${name}\nSource: llama.cpp/${path}\n\n${await readFile(resolve(native, path), 'utf8')}`);
for (const [name, path, start, end] of [
  ['miniaudio (MIT No Attribution)', 'vendor/miniaudio/miniaudio.h', 'ALTERNATIVE 2 - MIT No Attribution', '*/'],
  ['stb_image (MIT)', 'vendor/stb/stb_image.h', 'ALTERNATIVE A - MIT License', 'ALTERNATIVE B - Public Domain'],
  ['sheredom subprocess (Unlicense; disabled in this build)', 'vendor/sheredom/subprocess.h', 'This is free and unencumbered software', '*/'],
]) {
  const source = await readFile(resolve(native, path), 'utf8');
  const first = source.indexOf(start);
  const last = source.indexOf(end, first);
  if (first < 0 || last < first) throw new Error(`License markers missing: ${path}`);
  texts.push(`${name}\nSource: llama.cpp/${path}\n\n${source.slice(first, last).trim()}`);
}
await writeFile(resolve(output, 'native-vendors.txt'), texts.join('\n\n========================================\n\n') + '\n');

const lock = JSON.parse(await readFile(resolve(root, 'package-lock.json'), 'utf8'));
const licenses = [];
let count = 0;
for (const [path, entry] of Object.entries(lock.packages).sort(([a], [b]) => a.localeCompare(b))) {
  if (!path.startsWith('node_modules/') || entry.dev || entry.link) continue;
  const directory = resolve(root, path);
  let pkg;
  try { pkg = JSON.parse(await readFile(resolve(directory, 'package.json'), 'utf8')); }
  catch (error) { if (entry.optional && error.code === 'ENOENT') continue; throw error; }
  const files = (await readdir(directory)).filter((name) => /^(licen[cs]e|copying|notice)([._-]|$)/i.test(name)).sort();
  const parts = [];
  for (const file of files) {
    try { parts.push(`${file}\n${await readFile(resolve(directory, file), 'utf8')}`); }
    catch (error) { if (error.code !== 'EISDIR') throw error; }
  }
  if (!parts.length) {
    const readme = (await readdir(directory)).find((name) => /^readme(\.md)?$/i.test(name));
    if (readme) parts.push(`README license attribution\n${await readFile(resolve(directory, readme), 'utf8')}`);
  }
  licenses.push(`${pkg.name}@${pkg.version}\nInstalled path: ${relative(root, directory)}\nDeclared license: ${JSON.stringify(pkg.license ?? entry.license ?? 'unspecified')}\n${parts.join('\n\n')}`);
  count++;
}
await writeFile(resolve(output, 'frontend-dependencies.txt'), 'Production dependency notices; includes build utilities classified as production by the upstream manifest.\n\n' + licenses.join('\n\n========================================\n\n') + '\n');
console.log(`Bundled ${texts.length} native notices and ${count} production dependency notices.`);
