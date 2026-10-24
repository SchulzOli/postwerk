import { crc32, deflateSync } from 'node:zlib';
import { PDFDict, PDFDocument, PDFName, StandardFonts } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { emptyContent, PRINT_FORMATS, type PrintContent, type PrintFormat } from '../src/marketing';
import { printSize, renderPrint, toCmyk, wrapText, type PrintBrand } from '../src/print';

const MM = 72 / 25.4;

const brand: PrintBrand = {
  companyName: 'Praxis Ruhige Nähe',
  tagline: 'Bewegung, die gut tut',
  colors: { primary: '#0d9488', secondary: '#134e4a', accent: '#f59e0b', text: '#1f2937', background: '#f8fafc' },
  font: 'sans',
  website: 'https://praxis.example',
  email: 'hallo@praxis.example',
  phone: '030 123',
  address: 'Hauptstraße 1\n10115 Berlin',
  character: { name: 'Rudi', catchphrase: 'Rücken? Rudi hilft!' },
};

const content = (format: PrintFormat, overrides: Partial<PrintContent> = {}): PrintContent => ({
  ...(emptyContent('print', format) as PrintContent),
  headline: 'Rücken? 20 Minuten pro Woche reichen.',
  body: 'Hallo {name}, kurze Übungen fürs Büro und eine kostenlose Haltungsanalyse. 🙂',
  callToAction: 'Jetzt Termin buchen',
  qrUrl: 'https://praxis.example/termin',
  ...overrides,
});

/** A plain PNG of the given size (gray pixels). */
function png(width: number, height: number): Uint8Array {
  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 0, 0, 0, 0], 8); // 8-bit grayscale
  const rows = Buffer.alloc((width + 1) * height, 0x80);
  for (let row = 0; row < height; row++) rows[row * (width + 1)] = 0;
  return new Uint8Array(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', header), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]));
}

/** Whether the PDF carries its fonts (a font descriptor with an embedded TrueType file). */
const embedsFonts = (doc: PDFDocument) => doc.context.enumerateIndirectObjects().some(([, object]) => object instanceof PDFDict && object.has(PDFName.of('FontFile2')));

const boxOf = (doc: PDFDocument, name: 'TrimBox' | 'BleedBox') => {
  const page = doc.getPage(0);
  const box = name === 'TrimBox' ? page.getTrimBox() : page.getBleedBox();
  return [box.x / MM, box.y / MM, box.width / MM, box.height / MM].map((value) => Math.round(value * 10) / 10);
};

describe('print helpers', () => {
  it('converts brand colors to CMYK', () => {
    expect(toCmyk('#000000')).toMatchObject({ cyan: 0, magenta: 0, yellow: 0, key: 1 });
    expect(toCmyk('#ffffff')).toMatchObject({ cyan: 0, magenta: 0, yellow: 0, key: 0 });
    const teal = toCmyk('#0d9488') as unknown as { cyan: number; magenta: number; key: number };
    expect(teal.cyan).toBeGreaterThan(0.9);
    expect(teal.magenta).toBe(0);
  });

  it('wraps text to a width and keeps line breaks', async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const lines = wrapText('one two three four five six\nseven', font, 12, font.widthOfTextAtSize('one two three', 12));
    expect(lines).toEqual(['one two three', 'four five six', 'seven']);
    expect(wrapText('Donaudampfschifffahrt', font, 12, font.widthOfTextAtSize('Donau', 12))[0]).toBe('Donau');
  });

  it('takes the newspaper ad size from the piece', () => {
    expect(printSize('newspaper', { widthMm: 46, heightMm: 100 })).toEqual({ widthMm: 46, heightMm: 100 });
    expect(printSize('flyer_a5', {})).toEqual({ widthMm: 148, heightMm: 210 });
  });
});

describe('print PDFs', () => {
  it.each(Object.keys(PRINT_FORMATS) as PrintFormat[])('renders %s with embedded fonts and the right boxes', async (format) => {
    const result = await renderPrint(format, content(format), brand, {});
    const doc = await PDFDocument.load(result.pdf);
    const { widthMm: width, heightMm: height } = PRINT_FORMATS[format];
    expect(doc.getPageCount()).toBe(format === 'postcard_a6' ? 2 : 1);
    expect(embedsFonts(doc)).toBe(true);
    const page = doc.getPage(0).getSize();
    if (format === 'letter_a4') {
      // Letters are exactly A4, without bleed, for letter services.
      expect([page.width / MM, page.height / MM].map(Math.round)).toEqual([210, 297]);
      expect(doc.getPage(0).node.get(PDFName.of('TrimBox'))).toBeUndefined();
    } else {
      expect([page.width / MM, page.height / MM].map(Math.round)).toEqual([width + 6, height + 6]);
      expect(boxOf(doc, 'TrimBox')).toEqual([3, 3, width, height]);
      expect(boxOf(doc, 'BleedBox')).toEqual([0, 0, width + 6, height + 6]);
    }
  });

  it('adds crop marks outside the bleed on request', async () => {
    const { pdf } = await renderPrint('flyer_a6', content('flyer_a6'), brand, {}, { cropMarks: true });
    const doc = await PDFDocument.load(pdf);
    const page = doc.getPage(0).getSize();
    expect(Math.round(page.width / MM)).toBe(105 + 2 * (3 + 8));
    expect(boxOf(doc, 'TrimBox')).toEqual([11, 11, 105, 148]);
  });

  it('warns about blurry pictures and pictures it cannot use', async () => {
    const tiny = png(40, 40);
    const { warnings } = await renderPrint('poster_a2', content('poster_a2'), brand, { picture: tiny, logo: new Uint8Array([1, 2, 3, 4]) });
    expect(warnings).toContainEqual({ code: 'unsupportedImage', image: 'logo' });
    expect(warnings.find((warning) => warning.code === 'lowResolution')).toMatchObject({ image: 'picture' });
  });

  it('shrinks, then cuts text that does not fit', async () => {
    const long = 'Bewegung tut gut. '.repeat(400);
    const { warnings } = await renderPrint('flyer_a6', content('flyer_a6', { body: long }), brand, {});
    expect(warnings).toContainEqual({ code: 'textCut' });
    const medium = 'Bewegung tut gut. '.repeat(45);
    expect((await renderPrint('flyer_a6', content('flyer_a6', { body: medium }), brand, {})).warnings).toContainEqual({ code: 'textShrunk' });
  });

  it('continues long letters on further pages', async () => {
    const result = await renderPrint('letter_a4', content('letter_a4', { body: 'Ein Absatz über Rückengesundheit.\n'.repeat(80) }), brand, {}, { recipient: { name: 'Erika Mustermann', lines: ['Musterweg 12', '12345 Musterstadt', 'DEUTSCHLAND'] } });
    expect(result.pages).toBeGreaterThan(1);
    expect(result.warnings).toEqual([]);
  });
});
