/**
 * Print PDFs of a campaign's print pieces: flyers, posters, newspaper ads,
 * postcards and letters, laid out from the brand kit (colors, typeface, logo,
 * contact details and the brand character).
 *
 * Print shop files have bleed (and crop marks on request), embedded fonts and
 * CMYK colors for text and shapes; pictures stay as uploaded. Letters are
 * plain A4 with the address where a DIN 5008 (form B) window envelope shows
 * it, as letter services like Pingen expect.
 *
 * Server-only (`@maas/core/print`): it embeds fonts and reads image bytes.
 */
import fontkit from '@pdf-lib/fontkit';
import { cmyk, PDFDocument, PDFName, type Color, type PDFFont, type PDFImage, type PDFPage } from 'pdf-lib';
import { eq } from 'drizzle-orm';
import QRCode from 'qrcode';
import { workspaces, type BrandColors, type Database, type Piece } from '@maas/db';
import { getBrandKit } from './brand';
import { PRINT_FORMATS, type PrintContent, type PrintFormat } from './marketing';
import { findMedia } from './media';
import { PRINT_FONTS } from './print-fonts';
import { getMediaStorage } from './storage';

const PT_PER_MM = 72 / 25.4;
/** Below this, pictures look blurry in print. */
export const MIN_PRINT_DPI = 150;

export interface PrintBrand {
  companyName: string;
  tagline: string;
  colors: BrandColors;
  /** "sans" or "serif". */
  font: string;
  website: string;
  email: string;
  phone: string;
  address: string;
  character: { name: string; catchphrase: string } | null;
}

/** Image files (PNG or JPEG; others need the optional `sharp` package). */
export interface PrintImages {
  logo?: Uint8Array | null;
  picture?: Uint8Array | null;
  character?: Uint8Array | null;
}

export interface Recipient {
  name: string;
  /** Street, postcode and town, country (each a line). */
  lines: string[];
}

export interface PrintOptions {
  /** Bleed around the trim size in mm (default 3; letters never have one). */
  bleedMm?: number;
  /** Crop marks outside the bleed. */
  cropMarks?: boolean;
  /** Letters and postcards: who it goes to; `{name}` in texts becomes their name. */
  recipient?: Recipient;
  /** Letters: the date line, in this language. */
  locale?: string;
  date?: Date;
}

export type PrintImageName = keyof PrintImages;
export type PrintWarning =
  | { code: 'lowResolution'; image: PrintImageName; dpi: number }
  | { code: 'unsupportedImage'; image: PrintImageName }
  | { code: 'textShrunk' }
  | { code: 'textCut' };

export interface RenderedPrint {
  pdf: Uint8Array;
  pages: number;
  /** Trim size. */
  widthMm: number;
  heightMm: number;
  warnings: PrintWarning[];
}

/** The trim size of a print piece (newspaper ads take the size the paper sold). */
export function printSize(format: PrintFormat, content: Pick<PrintContent, 'widthMm' | 'heightMm'>): { widthMm: number; heightMm: number } {
  if (format === 'newspaper' && content.widthMm && content.heightMm) return { widthMm: content.widthMm, heightMm: content.heightMm };
  return { widthMm: PRINT_FORMATS[format].widthMm, heightMm: PRINT_FORMATS[format].heightMm };
}

// ------------------------------------------------------------------ colors

function hexParts(hex: string): [number, number, number] {
  const value = /^#([0-9a-f]{6})$/i.exec(hex)?.[1] ?? '000000';
  return [0, 2, 4].map((at) => parseInt(value.slice(at, at + 2), 16) / 255) as [number, number, number];
}

/** A straight RGB → CMYK conversion (no color profile); print shops proof it. */
export function toCmyk(hex: string): Color {
  const [r, g, b] = hexParts(hex);
  const k = 1 - Math.max(r, g, b);
  if (k >= 1) return cmyk(0, 0, 0, 1);
  return cmyk((1 - r - k) / (1 - k), (1 - g - k) / (1 - k), (1 - b - k) / (1 - k), k);
}

const luminance = (hex: string) => {
  const [r, g, b] = hexParts(hex).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
/** White or the brand's text color, whichever reads better on `background`. */
const onColor = (background: string, text: string) => (luminance(background) > 0.4 ? toCmyk(luminance(text) < 0.3 ? text : '#111111') : cmyk(0, 0, 0, 0));
const BLACK = cmyk(0, 0, 0, 1);
const WHITE = cmyk(0, 0, 0, 0);

// ------------------------------------------------------------------ fonts and text

interface Fonts {
  regular: PDFFont;
  bold: PDFFont;
  /** Code points the fonts can draw. */
  covers: Set<number>;
}

async function embedFonts(doc: PDFDocument, family: string): Promise<Fonts> {
  doc.registerFontkit(fontkit);
  const files = PRINT_FONTS[family === 'serif' ? 'serif' : 'sans'];
  // Subsetting also turns the WOFF files into the TrueType fonts PDF readers expect.
  const embed = (data: string) => doc.embedFont(Buffer.from(data, 'base64'), { subset: true });
  const [regular, bold] = await Promise.all([embed(files.regular), embed(files.bold)]);
  return { regular, bold, covers: new Set(regular.getCharacterSet()) };
}

/** Drops what the fonts cannot draw (emoji and the like). */
const printable = (fonts: Fonts, text: string) =>
  [...text.replace(/\r/g, '')].filter((char) => char === '\n' || fonts.covers.has(char.codePointAt(0)!)).join('');

/** Splits text into lines that fit `width` (pt); keeps the author's line breaks. */
export function wrapText(text: string, font: PDFFont, size: number, width: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    let line = '';
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const candidate = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= width) {
        line = candidate;
        continue;
      }
      if (line) lines.push(line);
      // A word longer than the line is broken where it must.
      line = '';
      for (const char of word) {
        if (font.widthOfTextAtSize(line + char, size) > width && line) {
          lines.push(line);
          line = '';
        }
        line += char;
      }
    }
    lines.push(line);
  }
  while (lines.length > 0 && lines.at(-1) === '') lines.pop();
  return lines;
}

const LEADING = 1.22;

// ------------------------------------------------------------------ images

const isPng = (bytes: Uint8Array) => bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
const isJpeg = (bytes: Uint8Array) => bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;

/** WebP and GIF become PNG when the optional `sharp` package is installed. */
async function toEmbeddable(bytes: Uint8Array): Promise<Uint8Array | null> {
  if (isPng(bytes) || isJpeg(bytes)) return bytes;
  try {
    const { default: sharp } = await import('sharp');
    return new Uint8Array(await sharp(bytes).png().toBuffer());
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------ drawing

/** Draws in millimetres from the trim box's top-left corner. */
class Sheet {
  constructor(
    readonly page: PDFPage,
    /** Trim box offset from the page's left and top edge, in mm. */
    readonly offset: number,
    readonly widthMm: number,
    readonly heightMm: number,
  ) {}

  private x = (mm: number) => (this.offset + mm) * PT_PER_MM;
  private y = (mm: number) => this.page.getHeight() - (this.offset + mm) * PT_PER_MM;

  rect(x: number, y: number, width: number, height: number, color: Color, radius = 0) {
    if (radius <= 0) {
      this.page.drawRectangle({ x: this.x(x), y: this.y(y + height), width: width * PT_PER_MM, height: height * PT_PER_MM, color });
      return;
    }
    const w = width * PT_PER_MM;
    const h = height * PT_PER_MM;
    const r = Math.min(radius * PT_PER_MM, w / 2, h / 2);
    const path = `M ${r} 0 H ${w - r} A ${r} ${r} 0 0 1 ${w} ${r} V ${h - r} A ${r} ${r} 0 0 1 ${w - r} ${h} H ${r} A ${r} ${r} 0 0 1 0 ${h - r} V ${r} A ${r} ${r} 0 0 1 ${r} 0 Z`;
    this.page.drawSvgPath(path, { x: this.x(x), y: this.y(y), color });
  }

  /** A speech bubble with its tail pointing down-left. */
  bubble(x: number, y: number, width: number, height: number, color: Color, border: Color) {
    const w = width * PT_PER_MM;
    const h = height * PT_PER_MM;
    const r = Math.min(4 * PT_PER_MM, h / 3);
    const t = Math.min(6 * PT_PER_MM, w / 5);
    const path = `M ${r} 0 H ${w - r} A ${r} ${r} 0 0 1 ${w} ${r} V ${h - r} A ${r} ${r} 0 0 1 ${w - r} ${h} H ${t * 1.6} L 0 ${h + t} L ${t * 0.8} ${h} H ${r} A ${r} ${r} 0 0 1 0 ${h - r} V ${r} A ${r} ${r} 0 0 1 ${r} 0 Z`;
    this.page.drawSvgPath(path, { x: this.x(x), y: this.y(y), color, borderColor: border, borderWidth: 0.8 });
  }

  line(x1: number, y1: number, x2: number, y2: number, color: Color, thickness = 0.5) {
    this.page.drawLine({ start: { x: this.x(x1), y: this.y(y1) }, end: { x: this.x(x2), y: this.y(y2) }, color, thickness });
  }

  /** Text lines from `top` (mm); returns the height used (mm). */
  lines(lines: string[], x: number, top: number, font: PDFFont, size: number, color: Color, align: 'left' | 'center' | 'right' = 'left', width = 0): number {
    const lineHeight = (size * LEADING) / PT_PER_MM;
    const ascent = font.heightAtSize(size, { descender: false }) / PT_PER_MM;
    lines.forEach((text, index) => {
      const textWidth = font.widthOfTextAtSize(text, size) / PT_PER_MM;
      const left = align === 'left' ? x : align === 'center' ? x + (width - textWidth) / 2 : x + width - textWidth;
      this.page.drawText(text, { x: this.x(left), y: this.y(top + ascent + index * lineHeight), size, font, color });
    });
    return lines.length * lineHeight;
  }

  image(image: PDFImage, x: number, y: number, width: number, height: number) {
    this.page.drawImage(image, { x: this.x(x), y: this.y(y + height), width: width * PT_PER_MM, height: height * PT_PER_MM });
  }

  qr(url: string, x: number, y: number, size: number) {
    const { modules } = QRCode.create(url, { errorCorrectionLevel: 'M' });
    const quiet = 2;
    const cell = size / (modules.size + quiet * 2);
    this.rect(x, y, size, size, WHITE);
    for (let row = 0; row < modules.size; row++) {
      for (let col = 0; col < modules.size; col++) {
        if (modules.data[row * modules.size + col]) this.rect(x + (col + quiet) * cell, y + (row + quiet) * cell, cell + 0.01, cell + 0.01, BLACK);
      }
    }
  }
}

const lineHeightMm = (size: number) => (size * LEADING) / PT_PER_MM;

/** The size of an image fitted into a box, keeping its proportions. */
function fit(image: PDFImage, maxWidth: number, maxHeight: number) {
  const scale = Math.min(maxWidth / image.width, maxHeight / image.height);
  return { width: image.width * scale, height: image.height * scale };
}

interface Context {
  doc: PDFDocument;
  fonts: Fonts;
  brand: PrintBrand;
  content: PrintContent;
  images: { logo: PDFImage | null; picture: PDFImage | null; character: PDFImage | null };
  warnings: PrintWarning[];
  text: (value: string) => string;
}

function noteResolution(ctx: Context, name: PrintImageName, image: PDFImage, widthMm: number) {
  const dpi = Math.round(image.width / (widthMm / 25.4));
  if (dpi < MIN_PRINT_DPI && !ctx.warnings.some((w) => w.code === 'lowResolution' && w.image === name)) ctx.warnings.push({ code: 'lowResolution', image: name, dpi });
}

const shortUrl = (url: string) => url.replace(/^https?:\/\//, '').replace(/\/$/, '');

/** The brand's address and ways to reach it, as lines that fit `width` (pt); items are never split. */
function contactLines(ctx: Context, font: PDFFont, size: number, width: number): string[] {
  const { brand } = ctx;
  const groups = [
    brand.address.split('\n').map((line) => line.trim()).filter(Boolean),
    [brand.phone, brand.email, shortUrl(brand.website)].filter(Boolean),
  ];
  const lines: string[] = [];
  for (const items of groups) {
    let line = '';
    for (const item of items.map(ctx.text)) {
      const candidate = line ? `${line} · ${item}` : item;
      if (!line || font.widthOfTextAtSize(candidate, size) <= width) line = candidate;
      else {
        lines.push(line);
        line = item;
      }
    }
    if (line) lines.push(...wrapText(line, font, size, width));
  }
  return lines;
}

/** The brand character's line in a speech bubble, with its picture underneath. Returns the height used. */
function drawCharacter(ctx: Context, sheet: Sheet, x: number, top: number, width: number, height: number, scale: number) {
  const character = ctx.brand.character;
  if (!character || !ctx.content.showCharacter) return 0;
  const image = ctx.images.character;
  const size = 10 * scale;
  const quote = character.catchphrase ? `„${ctx.text(character.catchphrase)}“` : '';
  const signature = `— ${ctx.text(character.name)}`;
  let imageWidth = 0;
  if (image) {
    const box = fit(image, width * 0.42, height);
    imageWidth = box.width;
    sheet.image(image, x, top + height - box.height, box.width, box.height);
    noteResolution(ctx, 'character', image, box.width);
  }
  const bubbleX = x + (image ? imageWidth * 0.85 : 0);
  const bubbleWidth = Math.min(width - (bubbleX - x), 70 * scale);
  const padding = 3 * scale;
  const quoteLines = quote ? wrapText(quote, ctx.fonts.bold, size, (bubbleWidth - padding * 2) * PT_PER_MM) : [];
  const bubbleHeight = padding * 2 + quoteLines.length * lineHeightMm(size) + lineHeightMm(size * 0.8);
  const bubbleTop = top + (image ? height * 0.15 : 0);
  sheet.bubble(bubbleX, bubbleTop, bubbleWidth, bubbleHeight, WHITE, toCmyk(ctx.brand.colors.primary));
  let y = bubbleTop + padding;
  y += sheet.lines(quoteLines, bubbleX + padding, y, ctx.fonts.bold, size, toCmyk(ctx.brand.colors.text));
  sheet.lines([signature], bubbleX + padding, y, ctx.fonts.regular, size * 0.8, toCmyk(ctx.brand.colors.primary));
  return height;
}

// ------------------------------------------------------------------ layouts

/** Headline, body and call to action in a column, shrunk to fit; returns the drawing steps. */
function textColumn(ctx: Context, width: number, available: number, scale: number, opts: { picture?: { min: number; max: number } } = {}) {
  // Small formats keep readable sizes.
  scale = Math.max(scale, 0.75);
  const headline = ctx.text(ctx.content.headline);
  const body = ctx.text(ctx.content.body);
  const cta = ctx.text(ctx.content.callToAction);
  const widthPt = width * PT_PER_MM;
  for (let factor = 1; ; factor *= 0.92) {
    const sizes = { headline: 30 * scale * factor, body: 11 * scale * factor, cta: 12 * scale * factor };
    const headlineLines = headline ? wrapText(headline, ctx.fonts.bold, sizes.headline, widthPt) : [];
    let bodyLines = body ? wrapText(body, ctx.fonts.regular, sizes.body, widthPt) : [];
    const gap = 4 * scale * factor;
    const ctaHeight = cta ? lineHeightMm(sizes.cta) + 5 * scale * factor : 0;
    const fixed = headlineLines.length * lineHeightMm(sizes.headline) + (bodyLines.length ? gap : 0) + bodyLines.length * lineHeightMm(sizes.body) + (cta ? gap + ctaHeight : 0);
    if (fixed <= available || factor < 0.55) {
      if (fixed > available) {
        // Still too long at the smallest size: cut the body.
        const room = available - (fixed - bodyLines.length * lineHeightMm(sizes.body));
        const keep = Math.max(0, Math.floor(room / lineHeightMm(sizes.body)));
        if (keep < bodyLines.length) {
          bodyLines = bodyLines.slice(0, keep);
          if (bodyLines.length > 0) bodyLines[bodyLines.length - 1] = `${bodyLines.at(-1)!.replace(/\s*\S{0,12}$/, '')} …`;
          ctx.warnings.push({ code: 'textCut' });
        }
      } else if (factor < 1) ctx.warnings.push({ code: 'textShrunk' });
      const used = headlineLines.length * lineHeightMm(sizes.headline) + (bodyLines.length ? gap : 0) + bodyLines.length * lineHeightMm(sizes.body) + (cta ? gap + ctaHeight : 0);
      // The picture gets the room the text leaves; too little room and it stays out.
      const room = opts.picture ? Math.min(opts.picture.max, available - used - gap) : 0;
      const pictureHeight = opts.picture && room >= opts.picture.min ? room : 0;
      return { sizes, headlineLines, bodyLines, gap, ctaHeight, cta, pictureHeight };
    }
  }
}

function drawCta(ctx: Context, sheet: Sheet, x: number, top: number, maxWidth: number, size: number, height: number) {
  const cta = ctx.text(ctx.content.callToAction);
  if (!cta) return;
  const width = Math.min(maxWidth, ctx.fonts.bold.widthOfTextAtSize(cta, size) / PT_PER_MM + height * 1.2);
  sheet.rect(x, top, width, height, toCmyk(ctx.brand.colors.accent), height / 2);
  const lines = wrapText(cta, ctx.fonts.bold, size, (width - height) * PT_PER_MM).slice(0, 1);
  sheet.lines(lines, x, top + (height - lineHeightMm(size)) / 2, ctx.fonts.bold, size, onColor(ctx.brand.colors.accent, ctx.brand.colors.text), 'center', width);
}

/** The brand band across the top: company name (and tagline) with the logo on the right. */
function drawBand(ctx: Context, sheet: Sheet, bleed: number, height: number, margin: number, scale: number) {
  const { colors } = ctx.brand;
  sheet.rect(-bleed, -bleed, sheet.widthMm + bleed * 2, height + bleed, toCmyk(colors.primary));
  const ink = onColor(colors.primary, colors.text);
  let logoWidth = 0;
  const logo = ctx.content.showLogo ? ctx.images.logo : null;
  if (logo) {
    const pad = height * 0.12;
    const box = fit(logo, sheet.widthMm * 0.3, height * 0.62);
    logoWidth = box.width + pad * 2;
    const left = sheet.widthMm - margin - logoWidth;
    const top = (height - box.height) / 2 - pad;
    sheet.rect(left, top, logoWidth, box.height + pad * 2, toCmyk(colors.background), pad);
    sheet.image(logo, left + pad, top + pad, box.width, box.height);
    noteResolution(ctx, 'logo', logo, box.width);
  }
  const width = (sheet.widthMm - margin * 2 - logoWidth - margin / 2) * PT_PER_MM;
  const nameSize = 13 * scale;
  const name = wrapText(ctx.text(ctx.brand.companyName), ctx.fonts.bold, nameSize, width).slice(0, 1);
  const tagline = ctx.brand.tagline ? wrapText(ctx.text(ctx.brand.tagline), ctx.fonts.regular, nameSize * 0.62, width).slice(0, 1) : [];
  const textHeight = lineHeightMm(nameSize) + tagline.length * lineHeightMm(nameSize * 0.62);
  let y = (height - textHeight) / 2;
  y += sheet.lines(name, margin, y, ctx.fonts.bold, nameSize, ink);
  sheet.lines(tagline, margin, y, ctx.fonts.regular, nameSize * 0.62, ink);
}

/** Contact lines (left) and the QR code (right) along the bottom; returns their height. */
function footerHeight(ctx: Context, width: number, scale: number) {
  const size = 7.5 * scale;
  const lines = ctx.content.showContact ? contactLines(ctx, ctx.fonts.regular, size, width * 0.7 * PT_PER_MM) : [];
  const qr = ctx.content.qrUrl ? Math.min(width * 0.22, 26 * scale) : 0;
  return { size, lines, qr, height: Math.max(lines.length * lineHeightMm(size), qr) };
}

function drawFooter(ctx: Context, sheet: Sheet, x: number, bottom: number, width: number, footer: ReturnType<typeof footerHeight>) {
  if (footer.qr) sheet.qr(ctx.content.qrUrl, x + width - footer.qr, bottom - footer.qr, footer.qr);
  const textHeight = footer.lines.length * lineHeightMm(footer.size);
  sheet.lines(footer.lines, x, bottom - textHeight, ctx.fonts.regular, footer.size, toCmyk(ctx.brand.colors.text));
}

function portrait(ctx: Context, sheet: Sheet, bleed: number) {
  const { widthMm: W, heightMm: H } = sheet;
  const scale = W / 148;
  const margin = Math.max(6, W * 0.07);
  const band = Math.max(14, H * 0.11);
  sheet.rect(-bleed, -bleed, W + bleed * 2, H + bleed * 2, toCmyk(ctx.brand.colors.background));
  drawBand(ctx, sheet, bleed, band, margin, scale);

  const inner = W - margin * 2;
  const footer = footerHeight(ctx, inner, scale);
  const hasCharacter = Boolean(ctx.brand.character && ctx.content.showCharacter);
  const characterHeight = hasCharacter ? Math.min(H * 0.24, W * 0.4) : 0;
  const top = band + margin * 0.9;
  const bottom = H - margin - footer.height - (footer.height ? margin * 0.6 : 0) - (characterHeight ? characterHeight + margin * 0.6 : 0);
  const picture = ctx.images.picture;
  const pictureMax = picture ? Math.min(inner / (picture.width / picture.height), H * 0.34) : 0;
  const column = textColumn(ctx, inner, bottom - top, scale, picture ? { picture: { min: Math.min(pictureMax, H * 0.08), max: pictureMax } } : {});

  let y = top;
  const ink = toCmyk(ctx.brand.colors.text);
  y += sheet.lines(column.headlineLines, margin, y, ctx.fonts.bold, column.sizes.headline, toCmyk(ctx.brand.colors.primary));
  if (picture && column.pictureHeight > 0) {
    const box = fit(picture, inner, column.pictureHeight);
    sheet.image(picture, margin + (inner - box.width) / 2, y + column.gap, box.width, box.height);
    noteResolution(ctx, 'picture', picture, box.width);
    y += column.gap + box.height;
  }
  if (column.bodyLines.length) y += column.gap + sheet.lines(column.bodyLines, margin, y + column.gap, ctx.fonts.regular, column.sizes.body, ink);
  if (column.cta) drawCta(ctx, sheet, margin, y + column.gap, inner, column.sizes.cta, column.ctaHeight);

  if (characterHeight) drawCharacter(ctx, sheet, margin, H - margin - footer.height - (footer.height ? margin * 0.6 : 0) - characterHeight, inner, characterHeight, scale);
  drawFooter(ctx, sheet, margin, H - margin, inner, footer);
}

/** Landscape: text on the left, picture and brand character on the right. `back` leaves the body for the reverse side. */
function landscape(ctx: Context, sheet: Sheet, bleed: number, withBody: boolean) {
  const { widthMm: W, heightMm: H } = sheet;
  const scale = H / 148;
  const margin = Math.max(6, H * 0.07);
  const band = Math.max(12, H * 0.14);
  sheet.rect(-bleed, -bleed, W + bleed * 2, H + bleed * 2, toCmyk(ctx.brand.colors.background));
  drawBand(ctx, sheet, bleed, band, margin, scale);

  const gutter = margin;
  const leftWidth = (W - margin * 2 - gutter) * 0.56;
  const rightX = margin + leftWidth + gutter;
  const rightWidth = W - margin - rightX;
  const top = band + margin * 0.8;
  // A postcard's front leaves text, contact details and the QR code to the back.
  const front = { ...ctx, content: withBody ? ctx.content : { ...ctx.content, body: '', showContact: false, qrUrl: '' } };
  const footer = footerHeight(front, leftWidth, scale);
  const bottom = H - margin - footer.height - (footer.height ? margin * 0.5 : 0);
  const column = textColumn(front, leftWidth, bottom - top, scale);

  let y = top;
  y += sheet.lines(column.headlineLines, margin, y, ctx.fonts.bold, column.sizes.headline, toCmyk(ctx.brand.colors.primary));
  if (column.bodyLines.length) y += column.gap + sheet.lines(column.bodyLines, margin, y + column.gap, ctx.fonts.regular, column.sizes.body, toCmyk(ctx.brand.colors.text));
  if (column.cta) drawCta(ctx, sheet, margin, y + column.gap, leftWidth, column.sizes.cta, column.ctaHeight);
  drawFooter(front, sheet, margin, H - margin, leftWidth, footer);

  const hasCharacter = Boolean(ctx.brand.character && ctx.content.showCharacter);
  const rightHeight = H - margin - top;
  const picture = ctx.images.picture;
  let pictureHeight = 0;
  if (picture) {
    const box = fit(picture, rightWidth, hasCharacter ? rightHeight * 0.5 : rightHeight);
    sheet.image(picture, rightX + (rightWidth - box.width) / 2, top, box.width, box.height);
    noteResolution(ctx, 'picture', picture, box.width);
    pictureHeight = box.height + margin * 0.5;
  }
  if (hasCharacter) drawCharacter(ctx, sheet, rightX, top + pictureHeight, rightWidth, rightHeight - pictureHeight, scale * 1.2);
}

/** The postcard's address side: message on the left, stamp and address on the right. */
function postcardBack(ctx: Context, sheet: Sheet, bleed: number, recipient: Recipient | undefined) {
  const { widthMm: W, heightMm: H } = sheet;
  const scale = H / 105;
  const margin = 7;
  sheet.rect(-bleed, -bleed, W + bleed * 2, H + bleed * 2, WHITE);
  const half = W / 2;
  const ink = toCmyk(ctx.brand.colors.text);
  sheet.line(half, margin, half, H - margin, toCmyk('#bbbbbb'), 0.5);

  const leftWidth = half - margin * 1.6;
  const footer = footerHeight(ctx, leftWidth, scale * 0.9);
  const size = 9.5 * scale;
  let body = wrapText(ctx.text(ctx.content.body), ctx.fonts.regular, size, leftWidth * PT_PER_MM);
  const room = Math.floor((H - margin * 2 - footer.height - 4) / lineHeightMm(size));
  if (body.length > room) {
    body = body.slice(0, Math.max(0, room));
    ctx.warnings.push({ code: 'textCut' });
  }
  sheet.lines(body, margin, margin, ctx.fonts.regular, size, ink);
  drawFooter(ctx, sheet, margin, H - margin, leftWidth, footer);

  // Stamp area and address lines (the print shop or postal service fills in postage).
  sheet.rect(W - margin - 22, margin, 22, 26, toCmyk('#f1f1f1'));
  const addressTop = H * 0.48;
  const addressX = half + margin * 0.8;
  const addressWidth = W - margin - addressX;
  if (recipient) {
    sheet.lines([recipient.name, ...recipient.lines].map(ctx.text), addressX, addressTop, ctx.fonts.regular, 10, ink);
  } else {
    for (let line = 0; line < 4; line++) sheet.line(addressX, addressTop + 7 + line * 8, addressX + addressWidth, addressTop + 7 + line * 8, toCmyk('#bbbbbb'), 0.5);
  }
}

/**
 * A letter on A4 following DIN 5008 form B: return line and recipient in the
 * window field (20 mm from the left, 45 mm from the top, 85 × 45 mm), then
 * date, subject (the headline), text and call to action. Long letters go on.
 */
function letter(ctx: Context, sheet: Sheet, recipient: Recipient | undefined, locale: string, date: Date) {
  const { doc } = ctx;
  const left = 25;
  const right = 20;
  const width = 210 - left - right;
  const ink = toCmyk(ctx.brand.colors.text);
  const accent = toCmyk(ctx.brand.colors.primary);

  // Letterhead: logo (or name) top right, a thin brand rule.
  const logo = ctx.content.showLogo ? ctx.images.logo : null;
  if (logo) {
    const box = fit(logo, 60, 22);
    sheet.image(logo, 210 - right - box.width, 12, box.width, box.height);
    noteResolution(ctx, 'logo', logo, box.width);
  } else {
    sheet.lines([ctx.text(ctx.brand.companyName)], 210 - right - 80, 16, ctx.fonts.bold, 16, accent, 'right', 80);
  }
  sheet.rect(left, 38, width, 0.6, accent);

  // Window field.
  const returnLine = ctx.text([ctx.brand.companyName, ...ctx.brand.address.split('\n')].map((part) => part.trim()).filter(Boolean).join(' · '));
  sheet.lines(wrapText(returnLine, ctx.fonts.regular, 7, 85 * PT_PER_MM).slice(0, 1), 20, 57.5, ctx.fonts.regular, 7, ink);
  if (recipient) sheet.lines([recipient.name, ...recipient.lines].map(ctx.text).slice(0, 6), 20, 63.5, ctx.fonts.regular, 10.5, ink);

  // Info block: date and contact, right of the window.
  const info = [new Intl.DateTimeFormat(locale, { dateStyle: 'long' }).format(date), '', ctx.brand.phone, ctx.brand.email, shortUrl(ctx.brand.website)]
    .filter((line, index) => index < 2 || line)
    .map(ctx.text);
  sheet.lines(info, 125, 50, ctx.fonts.regular, 9, ink);

  let page = sheet;
  let y = 98.5;
  const bottom = 265;
  if (ctx.content.headline) y += page.lines(wrapText(ctx.text(ctx.content.headline), ctx.fonts.bold, 12, width * PT_PER_MM), left, y, ctx.fonts.bold, 12, ink) + 6;
  const size = 11;
  for (const line of wrapText(ctx.text(ctx.content.body), ctx.fonts.regular, size, width * PT_PER_MM)) {
    if (y + lineHeightMm(size) > bottom) {
      page = new Sheet(doc.addPage([210 * PT_PER_MM, 297 * PT_PER_MM]), 0, 210, 297);
      y = 25;
    }
    y += page.lines([line], left, y, ctx.fonts.regular, size, ink);
  }
  if (ctx.content.callToAction) {
    if (y + 14 > bottom) {
      page = new Sheet(doc.addPage([210 * PT_PER_MM, 297 * PT_PER_MM]), 0, 210, 297);
      y = 25;
    }
    drawCta(ctx, page, left, y + 6, width, 11, 9);
    y += 15;
  }

  // The brand character signs off, if there is room; the QR code sits at the bottom left.
  const hasCharacter = Boolean(ctx.brand.character && ctx.content.showCharacter);
  if (hasCharacter && bottom - y > 40) drawCharacter(ctx, page, 210 - right - 95, bottom - 40, 95, 38, 1);
  if (ctx.content.qrUrl) page.qr(ctx.content.qrUrl, left, bottom - 24, 22);

  // Footer on every page.
  for (const each of doc.getPages()) {
    const footerSheet = new Sheet(each, 0, 210, 297);
    footerSheet.rect(left, 274, width, 0.3, accent);
    footerSheet.lines(contactLines(ctx, ctx.fonts.regular, 7.5, width * PT_PER_MM), left, 276, ctx.fonts.regular, 7.5, ink, 'center', width);
  }
}

/** Crop marks at the trim corners, outside the bleed. */
function drawCropMarks(page: PDFPage, offset: number, width: number, height: number, bleed: number) {
  const sheet = new Sheet(page, offset, width, height);
  const gap = bleed + 1;
  const length = 5;
  for (const x of [0, width]) {
    for (const y of [0, height]) {
      const dx = x === 0 ? -1 : 1;
      const dy = y === 0 ? -1 : 1;
      sheet.line(x + dx * gap, y, x + dx * (gap + length), y, BLACK, 0.25);
      sheet.line(x, y + dy * gap, x, y + dy * (gap + length), BLACK, 0.25);
    }
  }
}

/** Renders a print piece as a PDF. */
export async function renderPrint(format: PrintFormat, content: PrintContent, brand: PrintBrand, images: PrintImages, options: PrintOptions = {}): Promise<RenderedPrint> {
  const isLetter = format === 'letter_a4';
  const { widthMm, heightMm } = printSize(format, content);
  const bleed = isLetter ? 0 : Math.max(0, Math.min(options.bleedMm ?? 3, 10));
  const slug = !isLetter && options.cropMarks ? 8 : 0;
  const offset = bleed + slug;

  const doc = await PDFDocument.create();
  doc.setTitle(content.headline || brand.companyName);
  doc.setAuthor(brand.companyName);
  doc.setCreator('MarketingAsAService');
  doc.setProducer('MarketingAsAService');
  const fonts = await embedFonts(doc, brand.font);
  const warnings: PrintWarning[] = [];
  const embed = async (name: PrintImageName): Promise<PDFImage | null> => {
    const bytes = images[name];
    if (!bytes) return null;
    const usable = await toEmbeddable(bytes);
    if (!usable) {
      warnings.push({ code: 'unsupportedImage', image: name });
      return null;
    }
    return isPng(usable) ? doc.embedPng(usable) : doc.embedJpg(usable);
  };
  const [logo, picture, character] = await Promise.all([embed('logo'), embed('picture'), embed('character')]);
  const name = options.recipient?.name ?? '';
  const ctx: Context = {
    doc,
    fonts,
    brand,
    content,
    images: { logo, picture, character },
    warnings,
    // Without a recipient, "Hello {name}," becomes "Hello,".
    text: (value) => printable(fonts, name ? value.replaceAll('{name}', name) : value.replace(/ ?\{name\}/g, '')).replace(/ {2,}/g, ' '),
  };

  const newPage = () => {
    const page = doc.addPage([(widthMm + offset * 2) * PT_PER_MM, (heightMm + offset * 2) * PT_PER_MM]);
    if (!isLetter) {
      page.setTrimBox(offset * PT_PER_MM, offset * PT_PER_MM, widthMm * PT_PER_MM, heightMm * PT_PER_MM);
      page.setBleedBox(slug * PT_PER_MM, slug * PT_PER_MM, (widthMm + bleed * 2) * PT_PER_MM, (heightMm + bleed * 2) * PT_PER_MM);
    }
    return { page, sheet: new Sheet(page, offset, widthMm, heightMm) };
  };

  if (isLetter) {
    letter(ctx, newPage().sheet, options.recipient, options.locale ?? 'de', options.date ?? new Date());
  } else if (format === 'postcard_a6') {
    landscape(ctx, newPage().sheet, bleed, false);
    postcardBack(ctx, newPage().sheet, bleed, options.recipient);
  } else if (widthMm > heightMm) {
    landscape(ctx, newPage().sheet, bleed, true);
  } else {
    portrait(ctx, newPage().sheet, bleed);
  }
  if (slug) for (const page of doc.getPages()) drawCropMarks(page, offset, widthMm, heightMm, bleed);
  // Marks the file as made for print (and keeps viewers from scaling it down).
  doc.catalog.set(PDFName.of('ViewerPreferences'), doc.context.obj({ PrintScaling: 'None' }));

  const unique = warnings.filter((warning, index) => warnings.findIndex((other) => JSON.stringify(other) === JSON.stringify(warning)) === index);
  return { pdf: await doc.save(), pages: doc.getPageCount(), widthMm, heightMm, warnings: unique };
}

// ------------------------------------------------------------------ pieces

/** Reads an upload's bytes (null when it is gone). */
async function uploadBytes(key: string): Promise<Uint8Array | null> {
  const file = await getMediaStorage().get(key);
  return file ? new Uint8Array(await new Response(file.body).arrayBuffer()) : null;
}

/** The brand kit and pictures a print piece is drawn with. */
export async function printInputs(db: Database, workspaceId: string, content: PrintContent): Promise<{ brand: PrintBrand; images: PrintImages }> {
  const workspace = await db.query.workspaces.findFirst({ where: eq(workspaces.id, workspaceId) });
  const kit = await getBrandKit(db, { id: workspaceId, name: workspace?.name ?? '' });
  const characterImage = kit.character?.imageMediaIds[0];
  const ids = [kit.logoMediaId, content.imageMediaId, characterImage].filter((id): id is string => Boolean(id));
  const uploads = await findMedia(db, workspaceId, ids);
  const bytes = async (id: string | null | undefined) => {
    const row = id ? uploads.get(id) : undefined;
    return row?.kind === 'image' ? uploadBytes(row.key) : null;
  };
  const [logo, picture, character] = await Promise.all([bytes(kit.logoMediaId), bytes(content.imageMediaId), bytes(characterImage)]);
  return {
    brand: {
      companyName: kit.companyName,
      tagline: kit.tagline,
      colors: kit.colors,
      font: kit.font,
      website: kit.website,
      email: kit.email,
      phone: kit.phone,
      address: kit.address,
      character: kit.character && { name: kit.character.name, catchphrase: kit.character.catchphrase },
    },
    images: { logo, picture, character },
  };
}

/** Renders a campaign's print piece with the workspace's brand kit. */
export async function renderPiece(db: Database, piece: Pick<Piece, 'workspaceId' | 'kind' | 'format' | 'content'>, options: PrintOptions = {}): Promise<RenderedPrint> {
  if (piece.kind !== 'print' || !(piece.format in PRINT_FORMATS)) throw new Error(`not a print piece: ${piece.kind}/${piece.format}`);
  const content = piece.content as unknown as PrintContent;
  const { brand, images } = await printInputs(db, piece.workspaceId, content);
  return renderPrint(piece.format as PrintFormat, content, brand, images, options);
}
