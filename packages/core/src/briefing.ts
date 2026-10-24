/**
 * The production briefing of a spot: everything a studio, agency or speaker
 * needs to produce it true to the brand. Campaign and format, the brand's
 * voice and colors, the brand character with its reference pictures, and the
 * script scene by scene with time codes.
 */
import { PDFDocument, type PDFImage } from 'pdf-lib';
import type { BrandKit, Database, Piece } from '@maas/db';
import { getBrandKit } from './brand';
import type { Locale } from './i18n';
import { SPOT_FORMATS, spotTimecodes, timecode, type SpotContent, type SpotFormat } from './marketing';
import { findMedia } from './media';
import { briefingMessages } from './messages';
import { embedFonts, fit, isPng, lineHeightMm, onColor, PT_PER_MM, printable, Sheet, toCmyk, toEmbeddable, uploadBytes, wrapText, type Fonts } from './print';

const A4 = { width: 210, height: 297 };
const MARGIN = 18;
const BOTTOM = A4.height - 16;

export interface BriefingInput {
  title: string;
  format: SpotFormat;
  /** How people call the format ("Radio spot, 30 s"). */
  formatName: string;
  campaign: { name: string; message: string; audience: string };
  content: SpotContent;
  kit: Pick<BrandKit, 'companyName' | 'tagline' | 'tone' | 'dos' | 'donts' | 'colors' | 'font' | 'audience' | 'character'>;
  images: { logo?: Uint8Array | null; character?: Uint8Array[] };
}

/** Draws top to bottom and starts new pages as needed. */
class Flow {
  sheet: Sheet;
  y = MARGIN;
  constructor(
    private readonly doc: PDFDocument,
    private readonly onNewPage: (sheet: Sheet) => number,
  ) {
    this.sheet = this.page();
  }
  private page() {
    const sheet = new Sheet(this.doc.addPage([A4.width * PT_PER_MM, A4.height * PT_PER_MM]), 0, A4.width, A4.height);
    this.y = this.onNewPage(sheet);
    return sheet;
  }
  /** Makes room for `height` mm, on a new page if this one is full. */
  need(height: number) {
    if (this.y + height > BOTTOM) this.sheet = this.page();
  }
}

export async function renderSpotBriefing(input: BriefingInput, locale: Locale = 'en'): Promise<Uint8Array> {
  const t = briefingMessages[locale];
  const doc = await PDFDocument.create();
  doc.setTitle(`${t.title}: ${input.title}`);
  doc.setAuthor(input.kit.companyName);
  doc.setCreator('MarketingAsAService');
  const fonts: Fonts = await embedFonts(doc, input.kit.font);
  const text = (value: string) => printable(fonts, value);
  const colors = input.kit.colors;
  const ink = toCmyk(colors.text);
  const accent = toCmyk(colors.primary);
  const muted = toCmyk('#6b7280');
  const rule = toCmyk('#d1d5db');
  const width = A4.width - MARGIN * 2;

  const embed = async (bytes: Uint8Array | null | undefined): Promise<PDFImage | null> => {
    const usable = bytes ? await toEmbeddable(bytes) : null;
    if (!usable) return null;
    return isPng(usable) ? doc.embedPng(usable) : doc.embedJpg(usable);
  };
  const logo = await embed(input.images.logo);
  const pictures = (await Promise.all((input.images.character ?? []).slice(0, 2).map(embed))).filter((image): image is PDFImage => image !== null);

  // Every page: a brand band with the title (the first one larger).
  let pages = 0;
  const flow = new Flow(doc, (sheet) => {
    pages++;
    const band = pages === 1 ? 30 : 14;
    sheet.rect(0, 0, A4.width, band, accent);
    const on = onColor(colors.primary, colors.text);
    if (logo) {
      const box = fit(logo, 40, band - 10);
      sheet.rect(A4.width - MARGIN - box.width - 4, (band - box.height) / 2 - 2, box.width + 4, box.height + 4, toCmyk(colors.background), 2);
      sheet.image(logo, A4.width - MARGIN - box.width - 2, (band - box.height) / 2, box.width, box.height);
    }
    if (pages === 1) {
      sheet.lines([text(t.title).toUpperCase()], MARGIN, 7, fonts.bold, 8, on);
      sheet.lines(wrapText(text(input.title), fonts.bold, 18, (width - 50) * PT_PER_MM).slice(0, 1), MARGIN, 12, fonts.bold, 18, on);
      return 30 + 8;
    }
    sheet.lines([text(`${t.title}: ${input.title}`)], MARGIN, 4.5, fonts.bold, 10, on);
    return 14 + 8;
  });

  const heading = (label: string) => {
    flow.need(16);
    flow.y += 2;
    flow.y += flow.sheet.lines([text(label)], MARGIN, flow.y, fonts.bold, 13, accent) + 2;
  };
  /** Label and value rows; returns nothing, moves the flow. */
  const facts = (rows: [string, string][], columnWidth = width) => {
    for (const [label, value] of rows) {
      if (!value.trim()) continue;
      const lines = wrapText(text(value), fonts.regular, 10, (columnWidth - 38) * PT_PER_MM);
      const height = Math.max(1, lines.length) * lineHeightMm(10) + 1.5;
      flow.need(height);
      flow.sheet.lines([text(label)], MARGIN, flow.y, fonts.bold, 9, muted);
      flow.sheet.lines(lines, MARGIN + 38, flow.y, fonts.regular, 10, ink);
      flow.y += height;
    }
  };

  const spot = SPOT_FORMATS[input.format];
  facts([
    [t.campaign, input.campaign.name],
    [t.format, input.formatName],
    [t.length, t.seconds(spot.seconds)],
    [t.message, input.campaign.message],
    [t.audience, input.campaign.audience || input.kit.audience],
  ]);

  heading(t.brand);
  facts([
    [input.kit.companyName, input.kit.tagline],
    [t.tone, input.kit.tone],
    [t.dos, input.kit.dos],
    [t.donts, input.kit.donts],
  ]);
  if (spot.medium === 'video') {
    flow.need(12);
    flow.sheet.lines([text(t.colors)], MARGIN, flow.y, fonts.bold, 9, muted);
    (['primary', 'secondary', 'accent', 'text', 'background'] as const).forEach((key, index) => {
      const x = MARGIN + 38 + index * 26;
      flow.sheet.rect(x, flow.y, 6, 6, toCmyk(colors[key]), 1);
      flow.sheet.lines([colors[key]], x + 7.5, flow.y + 1, fonts.regular, 8, ink);
    });
    flow.y += 10;
  }

  const character = input.kit.character;
  if (character) {
    heading(`${t.character}: ${character.name}`);
    const pictureWidth = pictures.length ? 48 : 0;
    const top = flow.y;
    flow.sheet.lines(wrapText(text(t.characterNote), fonts.regular, 9, (width - pictureWidth - 4) * PT_PER_MM), MARGIN, flow.y, fonts.regular, 9, muted);
    flow.y += lineHeightMm(9) * 2 + 2;
    facts(
      [
        [t.role, character.role],
        [t.look, character.look],
        [t.personality, character.personality],
        [t.voice, character.voice],
        [t.catchphrase, character.catchphrase ? `„${character.catchphrase}“` : ''],
        [t.never, character.rules],
      ],
      width - pictureWidth - 4,
    );
    // Reference pictures beside the description (on the page it started on).
    let pictureY = top;
    for (const picture of pictures) {
      const box = fit(picture, pictureWidth, 55);
      if (pictureY + box.height > BOTTOM) break;
      flow.sheet.image(picture, A4.width - MARGIN - box.width, pictureY, box.width, box.height);
      pictureY += box.height + 3;
    }
    flow.y = Math.max(flow.y, Math.min(pictureY, BOTTOM));
  }

  // The script as a table; the header row repeats on every page.
  heading(t.script);
  const isVideo = spot.medium === 'video';
  const columns: { label: string; width: number; value: (index: number) => string }[] = [
    { label: t.time, width: 17, value: (index) => `${timecode(times[index]!.start)}–${timecode(times[index]!.end)}` },
    ...(isVideo ? [{ label: t.visual, width: 47, value: (index: number) => scenes[index]!.visual }] : []),
    { label: t.voiceOver, width: isVideo ? 47 : 87, value: (index) => scenes[index]!.voiceOver },
    ...(isVideo ? [{ label: t.onScreen, width: 26, value: (index: number) => scenes[index]!.onScreenText }] : []),
    { label: t.sound, width: isVideo ? 25 : 52, value: (index) => scenes[index]!.sound },
    { label: t.appears, width: 12, value: (index) => (scenes[index]!.character ? t.yes : '') },
  ];
  const scenes = input.content.scenes;
  const times = spotTimecodes(scenes);
  const size = 8.5;
  const pad = 1.5;
  const header = () => {
    const labels = columns.map((column) => wrapText(text(column.label), fonts.bold, 8, (column.width - pad * 2) * PT_PER_MM));
    const height = Math.max(...labels.map((lines) => lines.length)) * lineHeightMm(8) + pad * 2;
    flow.need(height + 10);
    flow.sheet.rect(MARGIN, flow.y, width, height, toCmyk('#f3f4f6'));
    let x = MARGIN;
    labels.forEach((lines, index) => {
      flow.sheet.lines(lines, x + pad, flow.y + pad, fonts.bold, 8, ink);
      x += columns[index]!.width;
    });
    flow.y += height;
  };
  header();
  scenes.forEach((_, index) => {
    const cells = columns.map((column) => wrapText(text(column.value(index)), fonts.regular, size, (column.width - pad * 2) * PT_PER_MM));
    const height = Math.max(...cells.map((lines) => Math.max(1, lines.length))) * lineHeightMm(size) + pad * 2;
    const before = flow.sheet;
    flow.need(height);
    if (flow.sheet !== before) header();
    let x = MARGIN;
    cells.forEach((lines, column) => {
      flow.sheet.lines(lines, x + pad, flow.y + pad, column === 0 ? fonts.bold : fonts.regular, size, ink);
      x += columns[column]!.width;
    });
    flow.y += height;
    flow.sheet.line(MARGIN, flow.y, MARGIN + width, flow.y, rule, 0.4);
  });

  if (input.content.directions.trim()) {
    heading(t.directions);
    for (const line of wrapText(text(input.content.directions), fonts.regular, 10, width * PT_PER_MM)) {
      flow.need(lineHeightMm(10));
      flow.y += flow.sheet.lines([line], MARGIN, flow.y, fonts.regular, 10, ink);
    }
  }

  // Page numbers, now that the count is known.
  const all = doc.getPages();
  all.forEach((page, index) => {
    new Sheet(page, 0, A4.width, A4.height).lines([text(t.page(index + 1, all.length))], MARGIN, A4.height - 11, fonts.regular, 8, muted, 'right', width);
  });
  return doc.save();
}

/** A spot's briefing with the workspace's brand kit, campaign and the character's reference pictures. */
export async function renderPieceBriefing(
  db: Database,
  workspace: { id: string; name: string },
  piece: Pick<Piece, 'title' | 'format' | 'content'>,
  campaign: { name: string; message: string; audience: string },
  formatName: string,
  locale: Locale,
): Promise<Uint8Array> {
  const kit = await getBrandKit(db, workspace);
  const ids = [kit.logoMediaId, ...(kit.character?.imageMediaIds ?? [])].filter((id): id is string => Boolean(id));
  const uploads = await findMedia(db, workspace.id, ids);
  const bytes = async (id: string | null | undefined) => {
    const row = id ? uploads.get(id) : undefined;
    return row?.kind === 'image' ? uploadBytes(row.key) : null;
  };
  const [logo, ...character] = await Promise.all([bytes(kit.logoMediaId), ...(kit.character?.imageMediaIds ?? []).slice(0, 2).map(bytes)]);
  return renderSpotBriefing(
    {
      title: piece.title,
      format: piece.format as SpotFormat,
      formatName,
      campaign,
      content: piece.content as unknown as SpotContent,
      kit,
      images: { logo, character: character.filter((image): image is Uint8Array => image !== null) },
    },
    locale,
  );
}
