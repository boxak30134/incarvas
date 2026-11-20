import { GoogleGenAI, ThinkingLevel } from '@google/genai/web';
import type {
  AiChatMessage,
  AiModelOption,
  AiProvider,
  AiRequestMode,
  AiStreamStatus,
  Slide,
  SlideBackground,
  SlideElement,
} from '../types/slide';
import { SLIDE_HEIGHT, SLIDE_WIDTH } from '../types/slide';
import {
  isValidKeyFormat,
  loadSecret,
  normalizeApiKey,
  providerToSecretSlot,
  sanitizeLogMessage,
} from './cryptoStorage';

const FIRST_CHUNK_TIMEOUT_MS = 9_000;
const CHUNK_GAP_TIMEOUT_MS = 12_000;
const TOTAL_REQUEST_BUDGET_MS = 45_000;

export const AI_MODEL_OPTIONS: AiModelOption[] = [
  {
    id: 'gemini-3-flash-preview',
    provider: 'google',
    label: 'Gemini 3 Flash',
    description: '빠른 응답·시각 레이아웃 이해 (기본 권장)',
    tokenBadge: '저비용 · 고속',
  },
  {
    id: 'gemini-3.1-flash-lite-preview',
    provider: 'google',
    label: 'Gemini 3.1 Flash-Lite',
    description: '초경량 고속 응답·무료 티어 절약형',
    tokenBadge: '초저비용 · 고속',
  },
  {
    id: 'gemini-3.8-flash',
    provider: 'google',
    label: 'Gemini 3.8 Flash',
    description: '고정밀 추론·복합 레이아웃 설계',
    tokenBadge: '중간 · 무료 티어 가능',
  },
  {
    id: 'gemini-3.6-flash',
    provider: 'google',
    label: 'Gemini 3.6 Flash',
    description: '안정적인 슬라이드 디자인·피드백 생성',
    tokenBadge: '저비용 · 빠름',
  },
  {
    id: 'gpt-4o-mini',
    provider: 'openai',
    label: 'GPT-4o mini',
    description: '가벼운 OpenAI 텍스트·디자인 JSON 생성',
    tokenBadge: '저비용',
  },
  {
    id: 'gpt-4o',
    provider: 'openai',
    label: 'GPT-4o',
    description: '고품질 시각 레이아웃·교육 내용 피드백',
    tokenBadge: '고성능',
  },
  {
    id: 'claude-sonnet-4-20250514',
    provider: 'anthropic',
    label: 'Claude Sonnet 4',
    description: '논리적 구성·세련된 한국어 표현 피드백',
    tokenBadge: '고성능',
  },
];

const GEMINI_FALLBACK_CHAIN = [
  'gemini-3-flash-preview',
  'gemini-3.1-flash-lite-preview',
  'gemini-3.8-flash',
  'gemini-3.6-flash',
];

let lastWorkingGeminiModel: string | null = null;

class EmptyStreamError extends Error {
  constructor() {
    super('AI 응답 스트림이 비어 있습니다.');
    this.name = 'EmptyStreamError';
  }
}

class TimeoutError extends Error {
  constructor(phase: string) {
    super(`응답 대기 시간 초과 (${phase})`);
    this.name = 'TimeoutError';
  }
}

export interface AiSlideDesignPatch {
  title?: string;
  background?: Partial<SlideBackground>;
  elements?: SlideElement[];
  explanation: string;
}

export interface AiRunResult {
  text: string;
  modelUsed: string;
  designPatch?: AiSlideDesignPatch;
}

function getEnvDevKey(provider: AiProvider): string {
  if (typeof __BYOK_ONLY_BUILD__ !== 'undefined' && __BYOK_ONLY_BUILD__) {
    return '';
  }
  if (provider === 'google') {
    return import.meta.env.VITE_GEMINI_API_KEY ?? '';
  }
  if (provider === 'openai') {
    return import.meta.env.VITE_OPENAI_API_KEY ?? '';
  }
  return import.meta.env.VITE_ANTHROPIC_API_KEY ?? '';
}

export async function resolveApiKey(provider: AiProvider): Promise<string> {
  const stored = normalizeApiKey(await loadSecret(providerToSecretSlot(provider)));
  if (stored) return stored;
  return normalizeApiKey(getEnvDevKey(provider));
}

export function extractHttpStatus(err: unknown): number | null {
  if (!err || typeof err !== 'object') return null;
  const anyErr = err as Record<string, unknown>;
  if (typeof anyErr.status === 'number') return anyErr.status;
  if (
    anyErr.error &&
    typeof anyErr.error === 'object' &&
    typeof (anyErr.error as Record<string, unknown>).code === 'number'
  ) {
    return (anyErr.error as Record<string, unknown>).code as number;
  }
  const msg = String(anyErr.message ?? '');
  const match = msg.match(/\b(400|401|403|404|429|500|502|503|504)\b/);
  return match ? Number(match[1]) : null;
}

type ErrorKind =
  | 'retryable'
  | 'fatal-model'
  | 'fatal-request'
  | 'fatal-auth'
  | 'cancelled';

function classifyError(err: unknown): ErrorKind {
  if (err instanceof DOMException && err.name === 'AbortError') {
    return 'cancelled';
  }
  if (err instanceof Error && err.name === 'AbortError') {
    return 'cancelled';
  }
  if (err instanceof TimeoutError || err instanceof EmptyStreamError) {
    return 'retryable';
  }
  const status = extractHttpStatus(err);
  if (status === 404) return 'fatal-model';
  if (status === 400) return 'fatal-request';
  if (status === 401 || status === 403) return 'fatal-auth';
  if (
    status === 429 ||
    status === 500 ||
    status === 502 ||
    status === 503 ||
    status === 504
  ) {
    return 'retryable';
  }
  const msg = err instanceof Error ? err.message.toLowerCase() : '';
  if (msg.includes('network') || msg.includes('fetch') || msg.includes('timeout')) {
    return 'retryable';
  }
  return 'fatal-request';
}

function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  signal: AbortSignal,
  phase: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const timer = window.setTimeout(() => {
      reject(new TimeoutError(phase));
    }, ms);
    const onAbort = () => {
      window.clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (val) => {
        window.clearTimeout(timer);
        signal.removeEventListener('abort', onAbort);
        resolve(val);
      },
      (err) => {
        window.clearTimeout(timer);
        signal.removeEventListener('abort', onAbort);
        reject(err);
      },
    );
  });
}

function sleepWithAbort(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const timer = window.setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      window.clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

function parseRetryAfterMs(err: unknown): number | null {
  if (!err || typeof err !== 'object') return null;
  const anyErr = err as Record<string, unknown>;
  const headers = anyErr.headers as Record<string, string> | undefined;
  const rawHeader =
    headers?.['retry-after'] ??
    headers?.['Retry-After'] ??
    (typeof anyErr.retryAfter === 'string' || typeof anyErr.retryAfter === 'number'
      ? String(anyErr.retryAfter)
      : undefined);

  if (rawHeader) {
    const seconds = Number(rawHeader);
    if (!Number.isNaN(seconds) && seconds > 0) {
      return Math.min(10_000, Math.round(seconds * 1000));
    }
  }
  const msg = String(anyErr.message ?? '');
  const match = msg.match(/retry[- ]after[:\s]+(\d+(?:\.\d+)?)\s*s?/i);
  if (match?.[1]) {
    const sec = Number(match[1]);
    if (!Number.isNaN(sec) && sec > 0) {
      return Math.min(10_000, Math.round(sec * 1000));
    }
  }
  return null;
}

function computeBackoffMs(attempt: number, retryAfterMs?: number | null): number {
  if (retryAfterMs && retryAfterMs > 0) {
    return Math.min(10_000, retryAfterMs);
  }
  const base = Math.min(8000, 1000 * 2 ** attempt);
  const jitter = base * (Math.random() * 0.4 - 0.2);
  return Math.max(400, Math.round(base + jitter));
}

function serializeElementSummary(el: SlideElement) {
  if (el.type === 'text') {
    return {
      id: el.id,
      type: el.type,
      x: Math.round(el.x),
      y: Math.round(el.y),
      w: Math.round(el.w),
      h: Math.round(el.h),
      text: el.text.slice(0, 180),
      fontSize: el.fontSize,
      color: el.color,
      align: el.align,
      bold: el.bold,
    };
  }
  if (el.type === 'shape') {
    return {
      id: el.id,
      type: el.type,
      shapeKind: el.shapeKind,
      x: Math.round(el.x),
      y: Math.round(el.y),
      w: Math.round(el.w),
      h: Math.round(el.h),
      fill: el.fill,
      stroke: el.stroke,
      text: el.text?.slice(0, 100),
    };
  }
  if (el.type === 'table') {
    return {
      id: el.id,
      type: el.type,
      x: Math.round(el.x),
      y: Math.round(el.y),
      w: Math.round(el.w),
      h: Math.round(el.h),
      rows: el.rows.slice(0, 6).map((r) => r.slice(0, 5)),
    };
  }
  return {
    id: el.id,
    type: 'image',
    x: Math.round(el.x),
    y: Math.round(el.y),
    w: Math.round(el.w),
    h: Math.round(el.h),
    alt: el.alt ?? '이미지',
  };
}

function summarizeScopedSlideForPrompt(
  slide: Slide,
  targetElementIds?: string[],
): string {
  if (targetElementIds && targetElementIds.length > 0) {
    const targetSet = new Set(targetElementIds);
    const targetElements = slide.elements
      .filter((el) => targetSet.has(el.id))
      .slice(0, 24);
    const lockedElements = slide.elements
      .filter((el) => !targetSet.has(el.id))
      .slice(0, 24);

    const targetBounds =
      targetElements.length > 0
        ? {
            minX: Math.round(Math.min(...targetElements.map((e) => e.x))),
            minY: Math.round(Math.min(...targetElements.map((e) => e.y))),
            maxX: Math.round(Math.max(...targetElements.map((e) => e.x + e.w))),
            maxY: Math.round(Math.max(...targetElements.map((e) => e.y + e.h))),
          }
        : undefined;

    return JSON.stringify({
      canvas: { width: SLIDE_WIDTH, height: SLIDE_HEIGHT },
      title: slide.title,
      background: slide.background,
      targetBounds,
      targetElements: targetElements.map(serializeElementSummary),
      lockedElements: lockedElements.map(serializeElementSummary),
      hasStylusSketch: slide.strokes.length > 0,
    });
  }

  return JSON.stringify({
    canvas: { width: SLIDE_WIDTH, height: SLIDE_HEIGHT },
    title: slide.title,
    background: slide.background,
    elements: slide.elements.slice(0, 24).map(serializeElementSummary),
    hasStylusSketch: slide.strokes.length > 0,
  });
}

function buildSystemInstruction(
  mode: AiRequestMode,
  isScopedDesign = false,
): string {
  if (mode === 'design') {
    const scopeRules = isScopedDesign
      ? [
          '중요(부분 디자인 한정 모드): 사용자가 선택한 `targetElements`(지정된 영역 `targetBounds` 내부)만 디자인을 새로 입히거나 개선하세요.',
          '`lockedElements`(비선택 요소)는 슬라이드에 그대로 유지되므로 응답 JSON의 `"elements"` 배열에 절대 포함하지 말고, `lockedElements` 영역과 겹치지 않게 `targetBounds` 주변에 배치하세요.',
          '응답 JSON의 `"elements"`에는 선택된 요소들을 대체할 디자인 요소들만 반환하세요.',
        ]
      : [
          '사용자의 현재 슬라이드 요소, 요청 프롬프트, 첨부된 슬라이드+S-Pen 스케치 이미지를 바탕으로 세련된 새 디자인을 JSON으로만 응답하세요.',
          '기존 이미지(`type: "image"`)가 있으면 id를 유지해 사라지지 않게 보호하세요.',
        ];

    return [
      '당신은 한국 교육대학원 수업·발표 자료 전문 프레젠테이션 디자이너입니다.',
      `슬라이드 캔버스 크기는 가로 ${SLIDE_WIDTH}px × 세로 ${SLIDE_HEIGHT}px (16:9)입니다.`,
      ...scopeRules,
      '반드시 순수 JSON 객체 하나만 반환하세요(마크다운 코드블록 밖 설명 금지). 스키마:',
      '{',
      '  "explanation": "적용한 디자인 컨셉과 변경 요약 (한국어 2~3줄)",',
      '  "background": { "color": "#hex", "gradient": "linear-gradient(...) 또는 빈 문자열", "pattern": "none" | "grid" | "dots" | "lined" },',
      '  "elements": [',
      '    { "type": "shape", "shapeKind": "rect" | "roundedRect" | "ellipse" | "triangle" | "arrowRight" | "line", "x": 40, "y": 40, "w": 880, "h": 90, "fill": "#1e3a8a", "stroke": "#1e3a8a", "strokeWidth": 0, "text": "", "textColor": "#ffffff", "fontSize": 18, "zIndex": 1 },',
      '    { "type": "text", "x": 60, "y": 56, "w": 840, "h": 60, "text": "제목", "fontSize": 32, "color": "#ffffff", "bold": true, "align": "left", "zIndex": 2 },',
      '    { "type": "table", "x": 60, "y": 160, "w": 840, "h": 240, "rows": [["항목","내용"]], "headerBg": "#1e3a8a", "cellBg": "#ffffff", "borderColor": "#cbd5e1", "textColor": "#0f172a", "fontSize": 15, "zIndex": 3 }',
      '  ]',
      '}',
      '모든 좌표(x, y, w, h)는 960x540 캔버스 안에 여백(최소 24px)을 두고 배치하며, 요소 수는 16개 이하로 간결하게 유지하세요.',
    ].join('\n');
  }

  return [
    '당신은 연세대학교 교육대학원 원우의 발표를 돕는 교육공학·수업설계 컨설턴트입니다.',
    '인사말·서론을 생략하고 핵심만 간결히 답하세요.',
    '슬라이드의 내용, 논리 흐름, 학습 목표 전달력, 시각적 정보 밀도를 분석하여:',
    '1) 핵심 요약 및 강점 (2줄)',
    '2) 논리적 보완점 및 구조 개선안 (번호 목록)',
    '3) 바로 반영할 수 있는 문구 수정 예시',
    '형식으로 명확하고 실용적인 한국어 피드백을 제공하세요.',
  ].join('\n');
}

function extractJsonObjectText(rawText: string): string | null {
  const fenced = rawText.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    return fenced[1].trim();
  }
  const firstBrace = rawText.indexOf('{');
  const lastBrace = rawText.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return rawText.slice(firstBrace, lastBrace + 1).trim();
  }
  return null;
}

export function parseDesignPatchFromResponse(
  rawText: string,
  originalSlide: Slide,
  targetElementIds?: string[],
): AiSlideDesignPatch | undefined {
  const jsonText = extractJsonObjectText(rawText);
  if (!jsonText) return undefined;

  try {
    const parsed = JSON.parse(jsonText) as {
      title?: string;
      explanation?: string;
      background?: Partial<SlideBackground>;
      elements?: Array<Record<string, unknown>>;
    };

    const isScoped = Boolean(targetElementIds && targetElementIds.length > 0);
    const targetSet = isScoped ? new Set(targetElementIds) : null;
    const lockedIds = targetSet
      ? new Set(
          originalSlide.elements
            .filter((el) => !targetSet.has(el.id))
            .map((el) => el.id),
        )
      : new Set<string>();

    const existingImages = new Map(
      originalSlide.elements
        .filter((el) => el.type === 'image')
        .map((el) => [el.id, el]),
    );

    const sanitizedElements: SlideElement[] = [];
    if (Array.isArray(parsed.elements)) {
      parsed.elements.forEach((raw, idx) => {
        const id =
          typeof raw.id === 'string' && raw.id.trim()
            ? raw.id
            : `ai-el-${Date.now()}-${idx}`;
        if (isScoped && lockedIds.has(id)) {
          return;
        }
        const x = clampNumber(raw.x, 12, SLIDE_WIDTH - 40, 48);
        const y = clampNumber(raw.y, 12, SLIDE_HEIGHT - 32, 48);
        const rawW = raw.w ?? raw.width;
        const rawH = raw.h ?? raw.height;
        const w = clampNumber(rawW, 32, SLIDE_WIDTH - x, 240);
        const h = clampNumber(rawH, 16, SLIDE_HEIGHT - y, 80);
        const zIndex = typeof raw.zIndex === 'number' ? raw.zIndex : idx + 1;

        if (raw.type === 'image') {
          const orig = existingImages.get(id);
          if (orig && orig.type === 'image') {
            sanitizedElements.push({
              ...orig,
              x,
              y,
              w,
              h,
              zIndex,
            });
          }
          return;
        }

        if (raw.type === 'table' && Array.isArray(raw.rows)) {
          const rows = raw.rows
            .slice(0, 8)
            .map((r) =>
              Array.isArray(r) ? r.slice(0, 6).map((c) => String(c ?? '')) : [],
            )
            .filter((r) => r.length > 0);
          if (rows.length > 0) {
            sanitizedElements.push({
              id,
              type: 'table',
              x,
              y,
              w,
              h,
              zIndex,
              rows,
              headerBg: strOr(raw.headerBg, '#1e3a8a'),
              cellBg: strOr(raw.cellBg, '#ffffff'),
              borderColor: strOr(raw.borderColor, '#cbd5e1'),
              textColor: strOr(raw.textColor, '#0f172a'),
              fontSize: clampNumber(raw.fontSize, 10, 28, 14),
            });
          }
          return;
        }

        if (raw.type === 'shape') {
          const allowedShapes = [
            'rect',
            'roundedRect',
            'ellipse',
            'triangle',
            'arrowRight',
            'line',
          ] as const;
          const candidateKind = raw.shapeKind ?? raw.shape;
          const shapeKind = allowedShapes.includes(
            candidateKind as (typeof allowedShapes)[number],
          )
            ? (candidateKind as (typeof allowedShapes)[number])
            : 'roundedRect';
          sanitizedElements.push({
            id,
            type: 'shape',
            shapeKind,
            x,
            y,
            w,
            h,
            zIndex,
            fill: strOr(raw.fill ?? raw.backgroundColor, '#dbeafe'),
            stroke: strOr(raw.stroke ?? raw.borderColor, '#2563eb'),
            strokeWidth: clampNumber(raw.strokeWidth, 0, 12, 2),
            opacity: clampNumber(raw.opacity, 0.1, 1, 1),
            text: typeof raw.text === 'string' ? raw.text : undefined,
            textColor: strOr(raw.textColor ?? raw.color, '#0f172a'),
            fontSize: clampNumber(raw.fontSize, 10, 48, 16),
          });
          return;
        }

        if (raw.type === 'text' || typeof raw.text === 'string') {
          const align =
            raw.align === 'center' || raw.align === 'right'
              ? raw.align
              : 'left';
          sanitizedElements.push({
            id,
            type: 'text',
            x,
            y,
            w,
            h,
            zIndex,
            text: String(raw.text ?? ''),
            fontSize: clampNumber(raw.fontSize, 11, 64, 20),
            fontFamily: strOr(raw.fontFamily, 'Pretendard, sans-serif'),
            color: strOr(raw.color ?? raw.fontColor, '#0f172a'),
            bold: Boolean(raw.bold),
            italic: Boolean(raw.italic),
            align,
            backgroundColor:
              typeof raw.backgroundColor === 'string' && raw.backgroundColor.trim()
                ? raw.backgroundColor
                : undefined,
            borderRadius:
              typeof raw.borderRadius === 'number'
                ? clampNumber(raw.borderRadius, 0, 32, 0)
                : undefined,
            padding:
              typeof raw.padding === 'number'
                ? clampNumber(raw.padding, 0, 32, 8)
                : 8,
          });
        }
      });
    }

    const bg = parsed.background;
    const normalizedBg: Partial<SlideBackground> | undefined = bg
      ? {
          color: strOr(bg.color, '#ffffff'),
          gradient:
            typeof bg.gradient === 'string' &&
            bg.gradient.trim() &&
            bg.gradient.trim().toLowerCase() !== 'none'
              ? bg.gradient.trim()
              : undefined,
          pattern:
            bg.pattern === 'grid' ||
            bg.pattern === 'dots' ||
            bg.pattern === 'lined'
              ? bg.pattern
              : 'none',
        }
      : undefined;

    return {
      title: typeof parsed.title === 'string' ? parsed.title : undefined,
      background: isScoped ? undefined : normalizedBg,
      elements: sanitizedElements.length > 0 ? sanitizedElements : undefined,
      explanation:
        typeof parsed.explanation === 'string' && parsed.explanation.trim()
          ? parsed.explanation.trim()
          : '슬라이드 디자인이 적용되었습니다.',
    };
  } catch {
    return undefined;
  }
}

function clampNumber(
  value: unknown,
  min: number,
  max: number,
  fallback: number,
): number {
  if (typeof value !== 'number' || Number.isNaN(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function strOr(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value : fallback;
}

async function openAndProbeGeminiStream<T>(
  openStream: () => Promise<AsyncIterable<T>>,
  parentSignal: AbortSignal,
  attemptController: AbortController,
): Promise<{ first: T; iterator: AsyncIterator<T> }> {
  try {
    return await withTimeout(
      (async () => {
        const stream = await openStream();
        const iterator = stream[Symbol.asyncIterator]();
        const firstResult = await iterator.next();
        if (firstResult.done) {
          throw new EmptyStreamError();
        }
        return { first: firstResult.value, iterator };
      })(),
      FIRST_CHUNK_TIMEOUT_MS,
      parentSignal,
      '첫 응답 대기',
    );
  } catch (err) {
    attemptController.abort();
    throw err;
  }
}

export interface RunAiParams {
  provider: AiProvider;
  modelId: string;
  mode: AiRequestMode;
  prompt: string;
  slide: Slide;
  targetElementIds?: string[];
  deckOutline?: string;
  slideSnapshotDataUrl?: string;
  history: AiChatMessage[];
  signal: AbortSignal;
  onStatus: (status: AiStreamStatus, detail?: string) => void;
  onChunk: (partialText: string) => void;
}

export async function runSlideAiRequest(params: RunAiParams): Promise<AiRunResult> {
  const {
    provider,
    modelId,
    mode,
    prompt,
    slide,
    targetElementIds,
    deckOutline,
    slideSnapshotDataUrl,
    history,
    signal,
    onStatus,
    onChunk,
  } = params;

  const apiKey = await resolveApiKey(provider);
  if (!apiKey) {
    throw new Error(
      `${provider.toUpperCase()} API 키가 설정되지 않았습니다. 우측 상단 [AI/드라이브 설정]에서 무료 BYOK 키를 입력해 주세요.`,
    );
  }
  if (!isValidKeyFormat(provider, apiKey)) {
    throw new Error(
      `${provider.toUpperCase()} API 키 형식이 올바르지 않습니다. 설정에서 키를 다시 확인해 주세요.`,
    );
  }

  const budgetController = new AbortController();
  let budgetTimedOut = false;
  const budgetTimer = window.setTimeout(() => {
    budgetTimedOut = true;
    budgetController.abort();
  }, TOTAL_REQUEST_BUDGET_MS);
  const onParentAbort = () => budgetController.abort();
  signal.addEventListener('abort', onParentAbort, { once: true });

  const combinedSignal = budgetController.signal;

  try {
    const recentHistory = history
      .filter((m) => !m.content.startsWith('⚠️') && !m.content.trim().startsWith('{'))
      .slice(-4)
      .map((m) => ({
        role: m.role,
        text: m.content.slice(0, 240),
      }));

    const isScopedDesign =
      mode === 'design' && Boolean(targetElementIds && targetElementIds.length > 0);

    const userContext = [
      `[요청 모드]: ${
        isScopedDesign
          ? `선택된 요소(${targetElementIds?.length ?? 0}개) 한정 디자인 수정`
          : mode === 'design'
            ? '슬라이드 전체 디자인 생성/수정'
            : '내용 요약 및 논리 피드백'
      }`,
      `[사용자 요청]: ${prompt.slice(0, 1000)}`,
      mode === 'feedback' && deckOutline
        ? `[전체 발표 목차 요약]:\n${deckOutline}`
        : '',
      `[현재 슬라이드 구조 JSON]:\n${summarizeScopedSlideForPrompt(slide, isScopedDesign ? targetElementIds : undefined)}`,
      recentHistory.length > 0
        ? `[이전 대화 요약]:\n${recentHistory.map((h) => `${h.role}: ${h.text}`).join('\n')}`
        : '',
    ]
      .filter(Boolean)
      .join('\n\n');

    const systemInstruction = buildSystemInstruction(mode, isScopedDesign);

    if (provider === 'google') {
      const candidateModels = Array.from(
        new Set([
          modelId,
          ...(lastWorkingGeminiModel ? [lastWorkingGeminiModel] : []),
          ...GEMINI_FALLBACK_CHAIN,
        ]),
      );
      return await runGeminiWithFallback({
        apiKey,
        models: candidateModels,
        systemInstruction,
        userContext,
        slideSnapshotDataUrl,
        mode,
        slide,
        targetElementIds: isScopedDesign ? targetElementIds : undefined,
        signal: combinedSignal,
        onStatus,
        onChunk,
      });
    }

    if (provider === 'openai') {
      onStatus('connecting', modelId);
      const text = await runOpenAiCompletion({
        apiKey,
        modelId,
        systemInstruction,
        userContext,
        slideSnapshotDataUrl,
        mode,
        signal: combinedSignal,
        onStatus,
        onChunk,
      });
      onStatus('done', modelId);
      return {
        text,
        modelUsed: modelId,
        designPatch:
          mode === 'design'
            ? parseDesignPatchFromResponse(
                text,
                slide,
                isScopedDesign ? targetElementIds : undefined,
              )
            : undefined,
      };
    }

    onStatus('connecting', modelId);
    const text = await runAnthropicCompletion({
      apiKey,
      modelId,
      systemInstruction,
      userContext,
      slideSnapshotDataUrl,
      mode,
      signal: combinedSignal,
      onStatus,
      onChunk,
    });
    onStatus('done', modelId);
    return {
      text,
      modelUsed: modelId,
      designPatch:
        mode === 'design'
          ? parseDesignPatchFromResponse(
              text,
              slide,
              isScopedDesign ? targetElementIds : undefined,
            )
          : undefined,
    };
  } catch (err) {
    if (budgetTimedOut && !signal.aborted) {
      throw new Error(
        'AI 서버 응답 시간이 초과되었습니다(45초). 잠시 후 [다시 시도]를 눌러 주세요.',
      );
    }
    const safeMsg = sanitizeLogMessage(
      err instanceof Error ? err.message : String(err),
      [apiKey],
    );
    throw new Error(safeMsg);
  } finally {
    window.clearTimeout(budgetTimer);
    signal.removeEventListener('abort', onParentAbort);
  }
}

function formatDesignStreamingPreview(rawJson: string): string {
  const expMatch = rawJson.match(/"explanation"\s*:\s*"((?:[^"\\]|\\.)*)/);
  if (expMatch?.[1]) {
    const cleanExp = expMatch[1]
      .replace(/\\n/g, '\n')
      .replace(/\\"/g, '"');
    return `${cleanExp}\n\n🎨 슬라이드 요소를 배치하는 중... (${rawJson.length}자 수신)`;
  }
  return `🎨 AI가 슬라이드 디자인을 생성하는 중... (${rawJson.length}자 수신)`;
}

async function runGeminiWithFallback(args: {
  apiKey: string;
  models: string[];
  systemInstruction: string;
  userContext: string;
  slideSnapshotDataUrl?: string;
  mode: AiRequestMode;
  slide: Slide;
  targetElementIds?: string[];
  signal: AbortSignal;
  onStatus: (status: AiStreamStatus, detail?: string) => void;
  onChunk: (partialText: string) => void;
}): Promise<AiRunResult> {
  const {
    apiKey,
    models,
    systemInstruction,
    userContext,
    slideSnapshotDataUrl,
    mode,
    slide,
    targetElementIds,
    signal,
    onStatus,
    onChunk,
  } = args;

  const ai = new GoogleGenAI({
    apiKey,
    httpOptions: {
      retryOptions: { attempts: 1 },
      timeout: FIRST_CHUNK_TIMEOUT_MS,
    },
  });
  const parts: Array<
    { text: string } | { inlineData: { mimeType: string; data: string } }
  > = [{ text: userContext }];

  if (slideSnapshotDataUrl && slideSnapshotDataUrl.includes(',')) {
    const [header, base64] = slideSnapshotDataUrl.split(',');
    const mimeMatch = header.match(/data:(.*?);/);
    const mimeType = mimeMatch?.[1] ?? 'image/jpeg';
    if (base64) {
      parts.push({ inlineData: { mimeType, data: base64 } });
    }
  }

  let lastError: unknown = null;

  for (let mIdx = 0; mIdx < models.length; mIdx += 1) {
    const currentModel = models[mIdx];
    const maxAttempts = 2;
    let useAdvancedConfig = true;

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      if (signal.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }

      if (attempt === 0) {
        onStatus(mIdx === 0 ? 'connecting' : 'fallback', currentModel);
      } else {
        onStatus('retrying', `${currentModel} (${attempt + 1}/${maxAttempts})`);
      }

      let accumulatedText = '';
      let finishReason: string | undefined;

      const emitProgress = (raw: string) => {
        if (mode === 'design') {
          onChunk(formatDesignStreamingPreview(raw));
        } else {
          onChunk(raw);
        }
      };

      const attemptController = new AbortController();
      const onAttemptParentAbort = () => attemptController.abort();
      signal.addEventListener('abort', onAttemptParentAbort, { once: true });

      try {
        const { first, iterator } = await openAndProbeGeminiStream(
          () =>
            ai.models.generateContentStream({
              model: currentModel,
              contents: [{ role: 'user', parts }],
              config: {
                systemInstruction,
                maxOutputTokens: mode === 'design' ? 4096 : 1500,
                temperature: mode === 'design' ? 0.5 : 0.4,
                abortSignal: attemptController.signal,
                httpOptions: {
                  retryOptions: { attempts: 1 },
                  timeout: FIRST_CHUNK_TIMEOUT_MS,
                },
                ...(useAdvancedConfig
                  ? {
                      thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
                      ...(mode === 'design'
                        ? { responseMimeType: 'application/json' }
                        : {}),
                    }
                  : {}),
              },
            }),
          signal,
          attemptController,
        );

        onStatus('streaming', currentModel);

        if (first.candidates?.[0]?.finishReason) {
          finishReason = String(first.candidates[0].finishReason);
        }
        if (first.text) {
          accumulatedText += first.text;
          emitProgress(accumulatedText);
        }

        while (true) {
          const next = await withTimeout(
            iterator.next(),
            CHUNK_GAP_TIMEOUT_MS,
            signal,
            '스트림 청크 수신',
          );
          if (next.done) break;
          if (next.value.candidates?.[0]?.finishReason) {
            finishReason = String(next.value.candidates[0].finishReason);
          }
          if (next.value.text) {
            accumulatedText += next.value.text;
            emitProgress(accumulatedText);
          }
        }

        if (!accumulatedText.trim()) {
          throw new EmptyStreamError();
        }

        const designPatch =
          mode === 'design'
            ? parseDesignPatchFromResponse(
                accumulatedText,
                slide,
                targetElementIds,
              )
            : undefined;

        if (mode === 'design' && !designPatch) {
          if (finishReason === 'MAX_TOKENS') {
            throw new Error(
              '응답 길이 제한(MAX_TOKENS)으로 디자인 생성이 중간에 끊겼습니다. 다시 시도해 주세요.',
            );
          }
          throw new EmptyStreamError();
        }

        lastWorkingGeminiModel = currentModel;
        onStatus('done', currentModel);
        return {
          text: accumulatedText,
          modelUsed: currentModel,
          designPatch,
        };
      } catch (err) {
        attemptController.abort();
        lastError = err;
        const kind = classifyError(err);

        if (kind === 'cancelled') {
          onStatus('cancelled');
          throw err;
        }

        if (!signal.aborted && err instanceof TimeoutError && accumulatedText.trim().length === 0) {
          break;
        }

        if (kind === 'fatal-request') {
          if (useAdvancedConfig) {
            useAdvancedConfig = false;
            continue;
          }
          break;
        }

        if (accumulatedText.trim().length > 0) {
          const partialPatch =
            mode === 'design'
              ? parseDesignPatchFromResponse(
                  accumulatedText,
                  slide,
                  targetElementIds,
                )
              : undefined;
          if (mode === 'design' && !partialPatch) {
            if (attempt < maxAttempts - 1) {
              await sleepWithAbort(
                Math.min(1500, computeBackoffMs(attempt, parseRetryAfterMs(err))),
                signal,
              );
              continue;
            }
            break;
          }
          lastWorkingGeminiModel = currentModel;
          onStatus('done', currentModel);
          const partialWithNotice = `${accumulatedText}\n\n*(네트워크 지연으로 스트림이 조기 종료되어 수신된 내용까지만 표시했습니다.)*`;
          return {
            text: partialWithNotice,
            modelUsed: currentModel,
            designPatch: partialPatch,
          };
        }

        if (kind === 'fatal-auth') {
          throw new Error(
            'API 키 인증에 실패했습니다(401/403). 무료 티어 한도 또는 키 유효성을 확인해 주세요.',
          );
        }
        if (kind === 'fatal-model') {
          break;
        }

        if (attempt < maxAttempts - 1) {
          await sleepWithAbort(
            Math.min(1500, computeBackoffMs(attempt, parseRetryAfterMs(err))),
            signal,
          );
        }
      } finally {
        signal.removeEventListener('abort', onAttemptParentAbort);
      }
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error('모든 Gemini 모델 호출에 실패했습니다.');
}

async function fetchSseWithRetry(args: {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
  modelId: string;
  providerLabel: string;
  mode: AiRequestMode;
  signal: AbortSignal;
  onStatus: (status: AiStreamStatus, detail?: string) => void;
  onChunk: (partialText: string) => void;
  extractDelta: (parsed: Record<string, unknown>) => string;
}): Promise<string> {
  const {
    url,
    headers,
    body,
    modelId,
    providerLabel,
    mode,
    signal,
    onStatus,
    onChunk,
    extractDelta,
  } = args;

  const maxAttempts = 3;
  let lastError: unknown = null;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (signal.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }

    onStatus(
      attempt === 0 ? 'connecting' : 'retrying',
      attempt === 0 ? modelId : `${modelId} (${attempt + 1}/${maxAttempts})`,
    );

    let accumulated = '';
    try {
      const res = await withTimeout(
        fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          signal,
        }),
        FIRST_CHUNK_TIMEOUT_MS,
        signal,
        `${providerLabel} 연결`,
      );

      if (!res.ok) {
        const retryHeader = res.headers.get('retry-after');
        const err = Object.assign(
          new Error(`${providerLabel} API 오류 (${res.status})`),
          { status: res.status, retryAfter: retryHeader },
        );
        throw err;
      }

      if (!res.body) {
        const data = (await res.json()) as Record<string, unknown>;
        const text = extractDelta(data);
        onStatus('streaming', modelId);
        onChunk(mode === 'design' ? formatDesignStreamingPreview(text) : text);
        return text;
      }

      onStatus('streaming', modelId);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await withTimeout(
          reader.read(),
          CHUNK_GAP_TIMEOUT_MS,
          signal,
          '스트림 수신',
        );
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const rawLine of lines) {
          const line = rawLine.trim();
          if (!line.startsWith('data:')) continue;
          const payload = line.slice(5).trim();
          if (!payload || payload === '[DONE]') continue;
          try {
            const parsed = JSON.parse(payload) as Record<string, unknown>;
            const delta = extractDelta(parsed);
            if (delta) {
              accumulated += delta;
              onChunk(
                mode === 'design'
                  ? formatDesignStreamingPreview(accumulated)
                  : accumulated,
              );
            }
          } catch {
            // Ignore partial SSE JSON frames
          }
        }
      }

      if (!accumulated.trim()) {
        throw new EmptyStreamError();
      }
      return accumulated;
    } catch (err) {
      lastError = err;
      const kind = classifyError(err);
      if (kind === 'cancelled') throw err;

      if (accumulated.trim().length > 0) {
        return accumulated;
      }
      if (kind === 'fatal-auth') {
        throw new Error(
          `${providerLabel} API 키 인증에 실패했습니다(401/403). 설정에서 키를 확인해 주세요.`,
        );
      }
      if (kind !== 'retryable' || attempt === maxAttempts - 1) {
        throw err;
      }
      await sleepWithAbort(
        computeBackoffMs(attempt, parseRetryAfterMs(err)),
        signal,
      );
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`${providerLabel} 요청에 실패했습니다.`);
}

async function runOpenAiCompletion(args: {
  apiKey: string;
  modelId: string;
  systemInstruction: string;
  userContext: string;
  slideSnapshotDataUrl?: string;
  mode: AiRequestMode;
  signal: AbortSignal;
  onStatus: (status: AiStreamStatus, detail?: string) => void;
  onChunk: (partialText: string) => void;
}): Promise<string> {
  const {
    apiKey,
    modelId,
    systemInstruction,
    userContext,
    slideSnapshotDataUrl,
    mode,
    signal,
    onStatus,
    onChunk,
  } = args;

  const userContent: Array<
    { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }
  > = [{ type: 'text', text: userContext }];
  if (slideSnapshotDataUrl) {
    userContent.push({
      type: 'image_url',
      image_url: { url: slideSnapshotDataUrl },
    });
  }

  return fetchSseWithRetry({
    url: 'https://api.openai.com/v1/chat/completions',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: {
      model: modelId,
      stream: true,
      max_tokens: mode === 'design' ? 4096 : 2048,
      ...(mode === 'design'
        ? { response_format: { type: 'json_object' } }
        : {}),
      messages: [
        { role: 'system', content: systemInstruction },
        { role: 'user', content: userContent },
      ],
    },
    modelId,
    providerLabel: 'OpenAI',
    mode,
    signal,
    onStatus,
    onChunk,
    extractDelta: (parsed) => {
      const choices = parsed.choices as
        | Array<{ delta?: { content?: string }; message?: { content?: string } }>
        | undefined;
      return choices?.[0]?.delta?.content ?? choices?.[0]?.message?.content ?? '';
    },
  });
}

async function runAnthropicCompletion(args: {
  apiKey: string;
  modelId: string;
  systemInstruction: string;
  userContext: string;
  slideSnapshotDataUrl?: string;
  mode: AiRequestMode;
  signal: AbortSignal;
  onStatus: (status: AiStreamStatus, detail?: string) => void;
  onChunk: (partialText: string) => void;
}): Promise<string> {
  const {
    apiKey,
    modelId,
    systemInstruction,
    userContext,
    slideSnapshotDataUrl,
    mode,
    signal,
    onStatus,
    onChunk,
  } = args;

  const content: Array<
    | { type: 'text'; text: string }
    | {
        type: 'image';
        source: { type: 'base64'; media_type: string; data: string };
      }
  > = [{ type: 'text', text: userContext }];

  if (slideSnapshotDataUrl && slideSnapshotDataUrl.includes(',')) {
    const [header, base64] = slideSnapshotDataUrl.split(',');
    const mimeMatch = header.match(/data:(.*?);/);
    const mediaType = mimeMatch?.[1] ?? 'image/jpeg';
    if (base64) {
      content.push({
        type: 'image',
        source: { type: 'base64', media_type: mediaType, data: base64 },
      });
    }
  }

  return fetchSseWithRetry({
    url: 'https://api.anthropic.com/v1/messages',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: {
      model: modelId,
      stream: true,
      max_tokens: mode === 'design' ? 4096 : 2048,
      system: systemInstruction,
      messages: [{ role: 'user', content }],
    },
    modelId,
    providerLabel: 'Anthropic',
    mode,
    signal,
    onStatus,
    onChunk,
    extractDelta: (parsed) => {
      const delta = parsed.delta as { text?: string } | undefined;
      return delta?.text ?? '';
    },
  });
}
