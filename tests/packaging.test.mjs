// Docker, the release build and the home-server copy each list the server's files by hand.
// A file missing from one of those lists crashes that build on start, so check every file the server imports.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
function serverFiles(entry, seen = new Set()) {
  if (seen.has(entry)) return seen;
  seen.add(entry);
  const src = fs.readFileSync(path.join(root, entry), 'utf8');
  for (const m of src.matchAll(/(?:from\s+|import\()\s*['"](\.{1,2}\/[^'"]+)['"]/g)) {
    serverFiles(path.posix.normalize(path.posix.join(path.posix.dirname(entry), m[1])), seen);
  }
  return seen;
}

const needed = [...serverFiles('server.js')];
const lists = {
  Dockerfile: fs.readFileSync(path.join(root, 'Dockerfile'), 'utf8'),
  'release.yml': fs.readFileSync(path.join(root, '.github/workflows/release.yml'), 'utf8'),
};

for (const [name, text] of Object.entries(lists)) {
  test(`${name} ships every file the server imports`, () => {
    const missing = needed.filter((f) => !text.includes(f.startsWith('src/') ? f : path.posix.basename(f)));
    assert.deepEqual(missing, [], `${name} is missing: ${missing.join(', ')}`);
  });
}

test('the home-server copy ships every file the replica imports', () => {
  const text = fs.readFileSync(path.join(root, 'scripts/home-server.ps1'), 'utf8');
  const missing = [...serverFiles('replica.js')].filter((f) => !text.includes(f));
  assert.deepEqual(missing, [], `home-server.ps1 is missing: ${missing.join(', ')}`);
});
