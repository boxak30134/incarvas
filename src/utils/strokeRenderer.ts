import type {
  InkPoint,
  InkStroke,
  Slide,
  SlideElement,
} from '../types/slide';
import { SLIDE_HEIGHT, SLIDE_WIDTH } from '../types/slide';

function smoothStep(t: number): number {
  const clamped = Math.max(0, Math.min(1, t));
  return clamped * clamped * (3 - 2 * clamped);
}

export function drawIncrementalStrokeSegment(
  ctx: CanvasRenderingContext2D,
  points: InkPoint[],
  fromIdx: number,
  color: string,
  baseWidth: number,
  tool: 'pen' | 'highlighter',
): void {
  if (points.length === 0) return;

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.globalAlpha = tool === 'highlighter' ? 0.35 : 1;

  if (points.length === 1) {
    const p = points[0];
    const r = Math.max(0.8, (baseWidth * (0.6 + p.pressure * 0.6)) / 2);
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return;
  }

  const start = Math.max(1, fromIdx);
  for (let i = start; i < points.length; i += 1) {
    const p0 = points[i - 1];
    const p1 = points[i];
    const prev = i >= 2 ? points[i - 2] : p0;
    const mid1x = (prev.x + p0.x) / 2;
    const mid1y = (prev.y + p0.y) / 2;
    const mid2x = (p0.x + p1.x) / 2;
    const mid2y = (p0.y + p1.y) / 2;

    const avgPressure = (p0.pressure + p1.pressure) / 2;
    const pressureScale =
      tool === 'highlighter' ? 1 : 0.65 + smoothStep(avgPressure) * 0.7;

    ctx.lineWidth = Math.max(1, baseWidth * pressureScale);
    ctx.beginPath();
    ctx.moveTo(mid1x, mid1y);
    ctx.quadraticCurveTo(p0.x, p0.y, mid2x, mid2y);
    ctx.stroke();
  }
  ctx.restore();
}

export function drawStroke(
  ctx: CanvasRenderingContext2D,
  stroke: InkStroke,
): void {
  if (stroke.points.length === 0) return;
  drawIncrementalStrokeSegment(
    ctx,
    stroke.points,
    1,
    stroke.color,
    stroke.width,
    stroke.tool,
  );
}

export function isPointNearStroke(
  x: number,
  y: number,
  stroke: InkStroke,
  threshold = 14,
): boolean {
  const r = threshold + stroke.width / 2;
  const r2 = r * r;
  for (const pt of stroke.points) {
    const dx = pt.x - x;
    const dy = pt.y - y;
    if (dx * dx + dy * dy <= r2) {
      return true;
    }
  }
  return false;
}

function loadHtmlImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function wrapTextLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string[] {
  const paragraphs = text.split('\n');
  const lines: string[] = [];
  for (const para of paragraphs) {
    if (!para) {
      lines.push('');
      continue;
    }
    let current = '';
    for (const ch of Array.from(para)) {
      const candidate = current + ch;
      if (ctx.measureText(candidate).width > maxWidth && current.length > 0) {
        lines.push(current);
        current = ch;
      } else {
        current = candidate;
      }
    }
    if (current) lines.push(current);
  }
  return lines;
}

function drawRoundedRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

async function drawElementToCanvas(
  ctx: CanvasRenderingContext2D,
  el: SlideElement,
): Promise<void> {
  ctx.save();
  ctx.globalAlpha = el.opacity ?? 1;

  if (el.type === 'shape') {
    ctx.fillStyle = el.fill;
    ctx.strokeStyle = el.stroke;
    ctx.lineWidth = el.strokeWidth;

    if (el.shapeKind === 'rect') {
      ctx.fillRect(el.x, el.y, el.w, el.h);
      if (el.strokeWidth > 0) ctx.strokeRect(el.x, el.y, el.w, el.h);
    } else if (el.shapeKind === 'roundedRect') {
      drawRoundedRectPath(ctx, el.x, el.y, el.w, el.h, 14);
      ctx.fill();
      if (el.strokeWidth > 0) ctx.stroke();
    } else if (el.shapeKind === 'ellipse') {
      ctx.beginPath();
      ctx.ellipse(
        el.x + el.w / 2,
        el.y + el.h / 2,
        el.w / 2,
        el.h / 2,
        0,
        0,
        Math.PI * 2,
      );
      ctx.fill();
      if (el.strokeWidth > 0) ctx.stroke();
    } else if (el.shapeKind === 'triangle') {
      ctx.beginPath();
      ctx.moveTo(el.x + el.w / 2, el.y);
      ctx.lineTo(el.x + el.w, el.y + el.h);
      ctx.lineTo(el.x, el.y + el.h);
      ctx.closePath();
      ctx.fill();
      if (el.strokeWidth > 0) ctx.stroke();
    } else if (el.shapeKind === 'arrowRight') {
      const headW = Math.min(el.w * 0.35, 42);
      const shaftTop = el.y + el.h * 0.25;
      const shaftBottom = el.y + el.h * 0.75;
      ctx.beginPath();
      ctx.moveTo(el.x, shaftTop);
      ctx.lineTo(el.x + el.w - headW, shaftTop);
      ctx.lineTo(el.x + el.w - headW, el.y);
      ctx.lineTo(el.x + el.w, el.y + el.h / 2);
      ctx.lineTo(el.x + el.w - headW, el.y + el.h);
      ctx.lineTo(el.x + el.w - headW, shaftBottom);
      ctx.lineTo(el.x, shaftBottom);
      ctx.closePath();
      ctx.fill();
      if (el.strokeWidth > 0) ctx.stroke();
    } else if (el.shapeKind === 'line') {
      ctx.beginPath();
      ctx.moveTo(el.x, el.y + el.h / 2);
      ctx.lineTo(el.x + el.w, el.y + el.h / 2);
      ctx.stroke();
    }

    if (el.text?.trim()) {
      const fontSize = el.fontSize ?? 16;
      ctx.fillStyle = el.textColor ?? '#0f172a';
      ctx.font = `600 ${fontSize}px Pretendard, "Noto Sans KR", sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const lines = wrapTextLines(ctx, el.text, Math.max(24, el.w - 16));
      const lineHeight = fontSize * 1.3;
      const totalH = lines.length * lineHeight;
      const startY = el.y + el.h / 2 - totalH / 2 + lineHeight / 2;
      lines.forEach((line, i) => {
        ctx.fillText(line, el.x + el.w / 2, startY + i * lineHeight);
      });
    }
  } else if (el.type === 'text') {
    if (el.backgroundColor) {
      ctx.fillStyle = el.backgroundColor;
      drawRoundedRectPath(
        ctx,
        el.x,
        el.y,
        el.w,
        el.h,
        el.borderRadius ?? 6,
      );
      ctx.fill();
    }
    const pad = el.padding ?? 8;
    const weight = el.bold ? '700' : '400';
    const style = el.italic ? 'italic' : 'normal';
    ctx.fillStyle = el.color;
    ctx.font = `${style} ${weight} ${el.fontSize}px ${el.fontFamily || 'Pretendard, sans-serif'}`;
    ctx.textBaseline = 'top';
    ctx.textAlign = el.align;

    const lines = wrapTextLines(ctx, el.text, Math.max(20, el.w - pad * 2));
    const lineHeight = el.fontSize * 1.35;
    const anchorX =
      el.align === 'center'
        ? el.x + el.w / 2
        : el.align === 'right'
          ? el.x + el.w - pad
          : el.x + pad;

    lines.forEach((line, i) => {
      const ly = el.y + pad + i * lineHeight;
      if (ly + lineHeight <= el.y + el.h + 4) {
        ctx.fillText(line, anchorX, ly);
      }
    });
  } else if (el.type === 'image') {
    const img = await loadHtmlImage(el.src);
    if (img) {
      if (el.borderRadius && el.borderRadius > 0) {
        drawRoundedRectPath(ctx, el.x, el.y, el.w, el.h, el.borderRadius);
        ctx.clip();
      }
      ctx.drawImage(img, el.x, el.y, el.w, el.h);
    }
  } else if (el.type === 'table') {
    const rowCount = el.rows.length;
    const colCount = Math.max(1, el.rows[0]?.length ?? 1);
    const cellW = el.w / colCount;
    const cellH = el.h / Math.max(1, rowCount);

    el.rows.forEach((row, rIdx) => {
      row.forEach((cell, cIdx) => {
        const cx = el.x + cIdx * cellW;
        const cy = el.y + rIdx * cellH;
        ctx.fillStyle = rIdx === 0 ? el.headerBg : el.cellBg;
        ctx.fillRect(cx, cy, cellW, cellH);
        ctx.strokeStyle = el.borderColor;
        ctx.lineWidth = 1;
        ctx.strokeRect(cx, cy, cellW, cellH);

        ctx.fillStyle = rIdx === 0 ? '#ffffff' : el.textColor;
        ctx.font = `${rIdx === 0 ? '600' : '400'} ${el.fontSize}px Pretendard, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(
          cell.slice(0, 24),
          cx + cellW / 2,
          cy + cellH / 2,
          cellW - 8,
        );
      });
    });
  }

  ctx.restore();
}

export async function renderSlideToDataUrl(
  slide: Slide,
  options: { scale?: number; mimeType?: 'image/jpeg' | 'image/png'; quality?: number; includeInk?: boolean } = {},
): Promise<string> {
  const scale = options.scale ?? 1;
  const mimeType = options.mimeType ?? 'image/jpeg';
  const quality = options.quality ?? 0.82;
  const includeInk = options.includeInk ?? true;

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(SLIDE_WIDTH * scale);
  canvas.height = Math.round(SLIDE_HEIGHT * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  ctx.scale(scale, scale);

  ctx.fillStyle = slide.background.color || '#ffffff';
  ctx.fillRect(0, 0, SLIDE_WIDTH, SLIDE_HEIGHT);

  if (slide.background.pattern === 'grid') {
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.2)';
    ctx.lineWidth = 1;
    for (let x = 0; x <= SLIDE_WIDTH; x += 24) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, SLIDE_HEIGHT);
      ctx.stroke();
    }
    for (let y = 0; y <= SLIDE_HEIGHT; y += 24) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(SLIDE_WIDTH, y);
      ctx.stroke();
    }
  } else if (slide.background.pattern === 'dots') {
    ctx.fillStyle = 'rgba(148, 163, 184, 0.38)';
    for (let x = 20; x < SLIDE_WIDTH; x += 20) {
      for (let y = 20; y < SLIDE_HEIGHT; y += 20) {
        ctx.beginPath();
        ctx.arc(x, y, 1.2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  } else if (slide.background.pattern === 'lined') {
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.22)';
    ctx.lineWidth = 1;
    for (let y = 28; y < SLIDE_HEIGHT; y += 28) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(SLIDE_WIDTH, y);
      ctx.stroke();
    }
  }

  const sorted = [...slide.elements].sort((a, b) => a.zIndex - b.zIndex);
  for (const el of sorted) {
    await drawElementToCanvas(ctx, el);
  }

  if (includeInk && slide.strokes.length > 0) {
    for (const stroke of slide.strokes) {
      drawStroke(ctx, stroke);
    }
  }

  return canvas.toDataURL(mimeType, quality);
}

export function renderInkLayerToDataUrl(strokes: InkStroke[]): string {
  const canvas = document.createElement('canvas');
  canvas.width = SLIDE_WIDTH * 2;
  canvas.height = SLIDE_HEIGHT * 2;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  ctx.scale(2, 2);
  for (const stroke of strokes) {
    drawStroke(ctx, stroke);
  }
  return canvas.toDataURL('image/png');
}
