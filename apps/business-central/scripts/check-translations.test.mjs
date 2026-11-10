import assert from 'node:assert/strict';
import { test } from 'node:test';
import { problems, units } from './check-translations.mjs';

const unit = (id, source, target) => `<trans-unit id="${id}" translate="yes"><source>${source}</source>${target === undefined ? '' : `<target>${target}</target>`}</trans-unit>`;
const file = (...list) => units(`<xliff><file><body>${list.join('')}</body></file></xliff>`);

test('reads sources and targets, with XML entities decoded', () => {
  const found = file(unit('Page 1 - Property 2', 'Save &amp; close', 'Speichern &amp; schließen'));
  assert.deepEqual(found.get('Page 1 - Property 2'), { source: 'Save & close', target: 'Speichern & schließen' });
});

test('a complete translation has no problems', () => {
  assert.deepEqual(problems(file(unit('a', 'Connection')), file(unit('a', 'Connection', 'Verbindung'))), []);
});

test('reports missing, empty, changed and unused texts', () => {
  const generated = file(unit('a', 'Connection'), unit('b', 'Server Address'), unit('c', 'Send'));
  const translated = file(unit('b', 'Server Address', ' '), unit('c', 'Send now', 'Jetzt senden'), unit('d', 'Old', 'Alt'));
  assert.deepEqual(problems(generated, translated), [
    'missing: "Connection" (a)',
    'missing: "Server Address" (b)',
    'changed: "Send now" is now "Send" (c)',
    'no longer used: "Old" (d)',
  ]);
});
