// Checks that every text of the app has a German translation and that it still
// belongs to the same English text. Run after a compile, which writes
// Translations/*.g.xlf from the source:
//   node scripts/check-translations.mjs
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = join(import.meta.dirname, '..', 'Translations');
const decode = (text) => text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

/** The texts of an XLIFF file by id: the English source and its translation. */
export function units(xml) {
  const found = new Map();
  for (const [, id, body] of xml.matchAll(/<trans-unit id="([^"]+)"[^>]*>([\s\S]*?)<\/trans-unit>/g)) {
    const source = /<source>([\s\S]*?)<\/source>/.exec(body)?.[1] ?? '';
    const target = /<target[^>]*>([\s\S]*?)<\/target>/.exec(body)?.[1] ?? '';
    found.set(id, { source: decode(source), target: decode(target) });
  }
  return found;
}

/** What a translation lacks compared with the generated file. */
export function problems(generated, translated) {
  const list = [];
  for (const [id, { source }] of generated) {
    const unit = translated.get(id);
    if (!unit || !unit.target.trim()) list.push(`missing: "${source}" (${id})`);
    else if (unit.source !== source) list.push(`changed: "${unit.source}" is now "${source}" (${id})`);
  }
  for (const [id, { source }] of translated) if (!generated.has(id)) list.push(`no longer used: "${source}" (${id})`);
  return list;
}

if (import.meta.filename === process.argv[1]) {
  const files = readdirSync(dir);
  const generatedFile = files.find((file) => file.endsWith('.g.xlf'));
  if (!generatedFile) {
    console.error('No Translations/*.g.xlf found. Compile the app first.');
    process.exit(1);
  }
  const generated = units(readFileSync(join(dir, generatedFile), 'utf8'));
  let failed = false;
  for (const language of ['de-DE']) {
    const file = generatedFile.replace('.g.xlf', `.${language}.xlf`);
    const list = files.includes(file) ? problems(generated, units(readFileSync(join(dir, file), 'utf8'))) : [`${file} is missing`];
    for (const problem of list) console.error(`${language}: ${problem}`);
    if (list.length === 0) console.log(`${language}: all ${generated.size} texts translated`);
    failed ||= list.length > 0;
  }
  process.exit(failed ? 1 : 0);
}
