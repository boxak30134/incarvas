import type { Slide, TextElement } from '../types/slide';

export interface SlideDiagnosticReport {
  score: number;
  warnings: string[];
  charCount: number;
  elementCount: number;
  hasSketch: boolean;
}

function hexToLuminance(hex: string | undefined): number | null {
  if (!hex) return null;
  const cleaned = hex.replace('#', '').trim();
  const full =
    cleaned.length === 3
      ? cleaned
          .split('')
          .map((c) => c + c)
          .join('')
      : cleaned;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null;
  const r = parseInt(full.slice(0, 2), 16) / 255;
  const g = parseInt(full.slice(2, 4), 16) / 255;
  const b = parseInt(full.slice(4, 6), 16) / 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function diagnoseSlideLocal(slide: Slide): SlideDiagnosticReport {
  const warnings: string[] = [];
  let charCount = 0;
  let smallFontCount = 0;
  let lowContrastCount = 0;

  const bgLum = hexToLuminance(slide.background.color) ?? 1;

  for (const el of slide.elements) {
    if (el.type === 'text') {
      charCount += el.text.trim().length;
      if (el.fontSize < 16) {
        smallFontCount += 1;
      }
      const textBgLum =
        hexToLuminance(el.backgroundColor) ?? (slide.background.gradient ? null : bgLum);
      const fgLum = hexToLuminance(el.color);
      if (textBgLum !== null && fgLum !== null) {
        const diff = Math.abs(textBgLum - fgLum);
        if (diff < 0.28) {
          lowContrastCount += 1;
        }
      }
    } else if (el.type === 'shape' && el.text) {
      charCount += el.text.trim().length;
    } else if (el.type === 'table') {
      for (const row of el.rows) {
        for (const cell of row) {
          charCount += cell.trim().length;
        }
      }
    }
  }

  if (slide.elements.length === 0 && slide.strokes.length === 0) {
    warnings.push('슬라이드가 비어 있습니다. 텍스트·도형 또는 S-Pen 스케치를 추가해 보세요.');
  }
  if (smallFontCount > 0) {
    warnings.push(`16px 미만 작은 글씨(${smallFontCount}개)가 있어 교실 투사 시 잘 안 보일 수 있습니다.`);
  }
  if (charCount > 260) {
    warnings.push(`글자 수(${charCount}자)가 많아 1슬라이드 1메시지 원칙에 맞게 요약을 권장합니다.`);
  }
  if (lowContrastCount > 0) {
    warnings.push(`배경과 글자색 대비가 낮은 요소(${lowContrastCount}개)가 감지되었습니다.`);
  }

  const penalty =
    smallFontCount * 10 +
    (charCount > 260 ? 15 : 0) +
    lowContrastCount * 15 +
    (slide.elements.length === 0 ? 30 : 0);

  return {
    score: Math.max(40, 100 - penalty),
    warnings,
    charCount,
    elementCount: slide.elements.length,
    hasSketch: slide.strokes.length > 0,
  };
}

export function buildDeckOutline(slides: Slide[]): string {
  const lines = slides.slice(0, 20).map((s, idx) => {
    const firstText = s.elements
      .filter((el): el is TextElement => el.type === 'text')
      .map((el) => el.text.replace(/\s+/g, ' ').trim())
      .find(Boolean);
    const snippet = firstText ? firstText.slice(0, 36) : '(내용 없음)';
    return `${idx + 1}. ${s.title}: ${snippet}`;
  });
  return lines.join('\n').slice(0, 800);
}
