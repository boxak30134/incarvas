import PptxGenJS from 'pptxgenjs';
import { jsPDF } from 'jspdf';
import type { DeckDocument, ShapeKind } from '../types/slide';
import { SLIDE_HEIGHT, SLIDE_WIDTH } from '../types/slide';
import {
  renderInkLayerToDataUrl,
  renderSlideToDataUrl,
} from '../utils/strokeRenderer';

const PPTX_WIDTH_IN = 10;
const PPTX_HEIGHT_IN = 5.625;

function toInchX(px: number): number {
  return Number(((px / SLIDE_WIDTH) * PPTX_WIDTH_IN).toFixed(3));
}

function toInchY(px: number): number {
  return Number(((px / SLIDE_HEIGHT) * PPTX_HEIGHT_IN).toFixed(3));
}

function stripHash(hex: string | undefined, fallback = 'FFFFFF'): string {
  if (!hex) return fallback;
  const cleaned = hex.replace('#', '').trim();
  if (/^[0-9a-fA-F]{6}$/.test(cleaned)) return cleaned.toUpperCase();
  if (/^[0-9a-fA-F]{3}$/.test(cleaned)) {
    return cleaned
      .split('')
      .map((c) => c + c)
      .join('')
      .toUpperCase();
  }
  return fallback;
}

function mapShapeKind(
  kind: ShapeKind,
  pres: PptxGenJS,
): PptxGenJS.ShapeType {
  switch (kind) {
    case 'rect':
      return pres.ShapeType.rect;
    case 'roundedRect':
      return pres.ShapeType.roundRect;
    case 'ellipse':
      return pres.ShapeType.ellipse;
    case 'triangle':
      return pres.ShapeType.triangle;
    case 'arrowRight':
      return pres.ShapeType.rightArrow;
    case 'line':
      return pres.ShapeType.line;
  }
}

export async function exportDeckToPptx(
  deck: DeckDocument,
  options: { includeInk?: boolean; onProgress?: (pct: number) => void } = {},
): Promise<void> {
  const includeInk = options.includeInk ?? true;
  const pres = new PptxGenJS();
  pres.layout = 'LAYOUT_16x9';
  pres.title = deck.title || 'InCarvas Presentation';

  const total = Math.max(1, deck.slides.length);

  for (let i = 0; i < deck.slides.length; i += 1) {
    const slideData = deck.slides[i];
    const pptSlide = pres.addSlide();
    pptSlide.background = {
      color: stripHash(slideData.background.color, 'FFFFFF'),
    };

    const sorted = [...slideData.elements].sort((a, b) => a.zIndex - b.zIndex);

    for (const el of sorted) {
      const x = toInchX(el.x);
      const y = toInchY(el.y);
      const w = Math.max(0.2, toInchX(el.w));
      const h = Math.max(0.15, toInchY(el.h));

      if (el.type === 'shape') {
        pptSlide.addShape(mapShapeKind(el.shapeKind, pres), {
          x,
          y,
          w,
          h,
          fill: { color: stripHash(el.fill, 'DBEAFE') },
          line: {
            color: stripHash(el.stroke, '2563EB'),
            width: el.strokeWidth,
          },
        });
        if (el.text?.trim()) {
          pptSlide.addText(el.text, {
            x,
            y,
            w,
            h,
            fontSize: Math.round((el.fontSize ?? 16) * 0.75),
            color: stripHash(el.textColor, '0F172A'),
            fontFace: 'Malgun Gothic',
            align: 'center',
            valign: 'middle',
          });
        }
      } else if (el.type === 'text') {
        pptSlide.addText(el.text || ' ', {
          x,
          y,
          w,
          h,
          fontSize: Math.round(el.fontSize * 0.75),
          color: stripHash(el.color, '0F172A'),
          fontFace: 'Malgun Gothic',
          bold: Boolean(el.bold),
          italic: Boolean(el.italic),
          align: el.align,
          valign: 'top',
          fill: el.backgroundColor
            ? { color: stripHash(el.backgroundColor, 'FFFFFF') }
            : undefined,
        });
      } else if (el.type === 'image') {
        pptSlide.addImage({
          data: el.src,
          x,
          y,
          w,
          h,
        });
      } else if (el.type === 'table') {
        const tableRows: PptxGenJS.TableRow[] = el.rows.map((row, rIdx) =>
          row.map((cell) => ({
            text: cell,
            options: {
              fill: {
                color: stripHash(
                  rIdx === 0 ? el.headerBg : el.cellBg,
                  rIdx === 0 ? '1E3A8A' : 'FFFFFF',
                ),
              },
              color: rIdx === 0 ? 'FFFFFF' : stripHash(el.textColor, '0F172A'),
              bold: rIdx === 0,
              fontSize: Math.round(el.fontSize * 0.75),
              fontFace: 'Malgun Gothic',
              align: 'center',
              valign: 'middle',
              border: {
                pt: 1,
                color: stripHash(el.borderColor, 'CBD5E1'),
              },
            },
          })),
        );
        pptSlide.addTable(tableRows, { x, y, w, h });
      }
    }

    if (includeInk && slideData.strokes.length > 0) {
      const inkDataUrl = renderInkLayerToDataUrl(slideData.strokes);
      if (inkDataUrl) {
        pptSlide.addImage({
          data: inkDataUrl,
          x: 0,
          y: 0,
          w: PPTX_WIDTH_IN,
          h: PPTX_HEIGHT_IN,
        });
      }
    }

    if (slideData.notes?.trim()) {
      pptSlide.addNotes(slideData.notes);
    }

    options.onProgress?.(Math.round(((i + 1) / total) * 100));
    await new Promise((r) => setTimeout(r, 0));
  }

  const safeTitle = (deck.title || 'presentation').replace(/[^\w가-힣\-_ ]/g, '');
  await pres.writeFile({ fileName: `${safeTitle || 'presentation'}.pptx` });
}

export async function exportDeckToPdf(
  deck: DeckDocument,
  options: { includeInk?: boolean; onProgress?: (pct: number) => void } = {},
): Promise<void> {
  const includeInk = options.includeInk ?? true;
  const pdf = new jsPDF({
    orientation: 'landscape',
    unit: 'px',
    format: [SLIDE_WIDTH, SLIDE_HEIGHT],
    hotfixes: ['px_scaling'],
  });

  const total = Math.max(1, deck.slides.length);

  for (let i = 0; i < deck.slides.length; i += 1) {
    if (i > 0) {
      pdf.addPage([SLIDE_WIDTH, SLIDE_HEIGHT], 'landscape');
    }
    const dataUrl = await renderSlideToDataUrl(deck.slides[i], {
      scale: 2,
      mimeType: 'image/png',
      includeInk,
    });
    if (dataUrl) {
      pdf.addImage(dataUrl, 'PNG', 0, 0, SLIDE_WIDTH, SLIDE_HEIGHT);
    }
    options.onProgress?.(Math.round(((i + 1) / total) * 100));
    await new Promise((r) => setTimeout(r, 0));
  }

  const safeTitle = (deck.title || 'presentation').replace(/[^\w가-힣\-_ ]/g, '');
  pdf.save(`${safeTitle || 'presentation'}.pdf`);
}
