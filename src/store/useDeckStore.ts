import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type {
  AiChatMessage,
  AiProvider,
  AiStreamStatus,
  DeckDocument,
  EditorTool,
  InkStroke,
  ShapeKind,
  Slide,
  SlideBackground,
  SlideElement,
} from '../types/slide';
import {
  loadDeckFromIndexedDb,
  saveDeckToIndexedDb,
} from '../services/cryptoStorage';

const DEFAULT_DECK_ID = 'incarvas-active-deck';
const MAX_HISTORY = 40;
const MAX_CHAT_MESSAGES = 200;

function makeId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

export function createBlankSlide(index = 1): Slide {
  return {
    id: makeId('slide'),
    title: `슬라이드 ${index}`,
    background: {
      color: '#ffffff',
      pattern: 'none',
    },
    elements: [
      {
        id: makeId('txt'),
        type: 'text',
        x: 72,
        y: 64,
        w: 816,
        h: 72,
        zIndex: 1,
        text: index === 1 ? '수업 주제를 입력하세요' : `슬라이드 ${index} 제목`,
        fontSize: 34,
        fontFamily: 'Pretendard, sans-serif',
        color: '#0f172a',
        bold: true,
        align: 'left',
        padding: 8,
      },
      {
        id: makeId('txt'),
        type: 'text',
        x: 72,
        y: 152,
        w: 816,
        h: 120,
        zIndex: 2,
        text: '도형·텍스트를 배치하거나 S-Pen으로 스케치한 뒤,\n우측 AI 프롬프트 창에 원하는 디자인 스타일을 요청해 보세요.',
        fontSize: 20,
        fontFamily: 'Pretendard, sans-serif',
        color: '#475569',
        bold: false,
        align: 'left',
        padding: 8,
      },
    ],
    strokes: [],
    notes: '',
  };
}

function createInitialDeck(): DeckDocument {
  return {
    id: DEFAULT_DECK_ID,
    title: '새 교육용 프레젠테이션',
    updatedAt: Date.now(),
    slides: [createBlankSlide(1)],
  };
}

let saveTimer: number | null = null;
function scheduleDeckPersist(deck: DeckDocument): void {
  if (saveTimer !== null) {
    window.clearTimeout(saveTimer);
  }
  saveTimer = window.setTimeout(() => {
    void saveDeckToIndexedDb(deck);
  }, 300);
}

interface DeckState {
  deck: DeckDocument;
  hydrated: boolean;
  activeSlideId: string;
  selectedElementId: string | null;
  activeTool: EditorTool;
  penColor: string;
  penWidth: number;
  past: DeckDocument[];
  future: DeckDocument[];

  aiProvider: AiProvider;
  aiModelId: string;
  aiMessages: AiChatMessage[];
  aiStatus: AiStreamStatus;
  aiStatusDetail: string;

  hydrate: () => Promise<void>;
  setDeckTitle: (title: string) => void;
  replaceDeck: (newDeck: DeckDocument) => void;
  setActiveSlide: (slideId: string) => void;
  addSlide: () => void;
  duplicateSlide: (slideId: string) => void;
  deleteSlide: (slideId: string) => void;

  setActiveTool: (tool: EditorTool) => void;
  setPenColor: (color: string) => void;
  setPenWidth: (width: number) => void;
  setSelectedElementId: (id: string | null) => void;

  addTextElement: (x?: number, y?: number) => void;
  addShapeElement: (shapeKind: ShapeKind, x?: number, y?: number) => void;
  addImageElement: (src: string, alt?: string) => void;
  addTableElement: (rows?: number, cols?: number) => void;
  updateElement: (
    elementId: string,
    patch: Partial<SlideElement>,
    recordHistory?: boolean,
  ) => void;
  commitSnapshotForUndo: (snapshotBeforeEdit: DeckDocument) => void;
  deleteElement: (elementId: string) => void;
  updateSlideBackground: (bg: Partial<SlideBackground>) => void;
  updateSlideNotes: (notes: string) => void;

  addInkStroke: (stroke: InkStroke) => void;
  eraseStrokesByIds: (strokeIds: string[]) => void;
  clearSlideInk: () => void;

  applyAiDesignPatch: (patch: {
    title?: string;
    background?: Partial<SlideBackground>;
    elements?: SlideElement[];
  }) => void;

  undo: () => void;
  redo: () => void;

  setAiModel: (provider: AiProvider, modelId: string) => void;
  setAiStatus: (status: AiStreamStatus, detail?: string) => void;
  appendAiMessage: (msg: Omit<AiChatMessage, 'id' | 'createdAt'>) => string;
  updateAiMessageContent: (id: string, content: string, extra?: Partial<AiChatMessage>) => void;
  clearAiMessages: () => void;
}

const initialDeck = createInitialDeck();

function pushHistory(
  state: DeckState,
  nextDeck: DeckDocument,
): { deck: DeckDocument; past: DeckDocument[]; future: DeckDocument[] } {
  const stamped: DeckDocument = { ...nextDeck, updatedAt: Date.now() };
  scheduleDeckPersist(stamped);
  return {
    deck: stamped,
    past: [...state.past.slice(-(MAX_HISTORY - 1)), state.deck],
    future: [],
  };
}

export const useDeckStore = create<DeckState>()(
  persist(
    (set) => ({
      deck: initialDeck,
      hydrated: false,
      activeSlideId: initialDeck.slides[0].id,
      selectedElementId: null,
      activeTool: 'select',
      penColor: '#ef4444',
      penWidth: 3,
      past: [],
      future: [],

      aiProvider: 'google',
      aiModelId: 'gemini-3-flash-preview',
      aiMessages: [],
      aiStatus: 'idle',
      aiStatusDetail: '',

      hydrate: async () => {
        const stored = await loadDeckFromIndexedDb(DEFAULT_DECK_ID);
        if (stored && stored.slides.length > 0) {
          set({
            deck: stored,
            activeSlideId: stored.slides[0].id,
            selectedElementId: null,
            hydrated: true,
          });
        } else {
          set({ hydrated: true });
        }
      },

      setDeckTitle: (title) =>
        set((state) => {
          const nextDeck: DeckDocument = {
            ...state.deck,
            title,
            updatedAt: Date.now(),
          };
          scheduleDeckPersist(nextDeck);
          return { deck: nextDeck };
        }),

      replaceDeck: (newDeck) =>
        set((state) => {
          const normalized: DeckDocument = {
            ...newDeck,
            id: DEFAULT_DECK_ID,
            updatedAt: Date.now(),
          };
          return {
            ...pushHistory(state, normalized),
            activeSlideId: normalized.slides[0]?.id ?? '',
            selectedElementId: null,
          };
        }),

      setActiveSlide: (slideId) =>
        set({ activeSlideId: slideId, selectedElementId: null }),

      addSlide: () =>
        set((state) => {
          const newSlide = createBlankSlide(state.deck.slides.length + 1);
          const nextDeck: DeckDocument = {
            ...state.deck,
            slides: [...state.deck.slides, newSlide],
          };
          return {
            ...pushHistory(state, nextDeck),
            activeSlideId: newSlide.id,
            selectedElementId: null,
          };
        }),

      duplicateSlide: (slideId) =>
        set((state) => {
          const idx = state.deck.slides.findIndex((s) => s.id === slideId);
          if (idx < 0) return state;
          const orig = state.deck.slides[idx];
          const copy: Slide = {
            ...structuredClone(orig),
            id: makeId('slide'),
            title: `${orig.title} (복사)`,
          };
          const slides = [...state.deck.slides];
          slides.splice(idx + 1, 0, copy);
          return {
            ...pushHistory(state, { ...state.deck, slides }),
            activeSlideId: copy.id,
            selectedElementId: null,
          };
        }),

      deleteSlide: (slideId) =>
        set((state) => {
          if (state.deck.slides.length <= 1) return state;
          const idx = state.deck.slides.findIndex((s) => s.id === slideId);
          if (idx < 0) return state;
          const slides = state.deck.slides.filter((s) => s.id !== slideId);
          const nextActive =
            state.activeSlideId === slideId
              ? slides[Math.max(0, idx - 1)].id
              : state.activeSlideId;
          return {
            ...pushHistory(state, { ...state.deck, slides }),
            activeSlideId: nextActive,
            selectedElementId: null,
          };
        }),

      setActiveTool: (tool) => set({ activeTool: tool }),
      setPenColor: (penColor) => set({ penColor }),
      setPenWidth: (penWidth) => set({ penWidth }),
      setSelectedElementId: (selectedElementId) => set({ selectedElementId }),

      addTextElement: (x = 120, y = 180) =>
        set((state) => {
          const id = makeId('txt');
          const slides = state.deck.slides.map((s) => {
            if (s.id !== state.activeSlideId) return s;
            const maxZ = s.elements.reduce((m, e) => Math.max(m, e.zIndex), 0);
            const newEl: SlideElement = {
              id,
              type: 'text',
              x,
              y,
              w: 360,
              h: 96,
              zIndex: maxZ + 1,
              text: '텍스트를 입력하세요',
              fontSize: 22,
              fontFamily: 'Pretendard, sans-serif',
              color: '#0f172a',
              align: 'left',
              padding: 8,
            };
            return { ...s, elements: [...s.elements, newEl] };
          });
          return {
            ...pushHistory(state, { ...state.deck, slides }),
            selectedElementId: id,
            activeTool: 'select',
          };
        }),

      addShapeElement: (shapeKind, x = 220, y = 180) =>
        set((state) => {
          const id = makeId('shp');
          const slides = state.deck.slides.map((s) => {
            if (s.id !== state.activeSlideId) return s;
            const maxZ = s.elements.reduce((m, e) => Math.max(m, e.zIndex), 0);
            const newEl: SlideElement = {
              id,
              type: 'shape',
              shapeKind,
              x,
              y,
              w: shapeKind === 'line' ? 260 : 200,
              h: shapeKind === 'line' ? 24 : 120,
              zIndex: maxZ + 1,
              fill: '#dbeafe',
              stroke: '#2563eb',
              strokeWidth: 2,
              text: shapeKind === 'line' ? '' : '도형 텍스트',
              textColor: '#1e3a8a',
              fontSize: 16,
            };
            return { ...s, elements: [...s.elements, newEl] };
          });
          return {
            ...pushHistory(state, { ...state.deck, slides }),
            selectedElementId: id,
            activeTool: 'select',
          };
        }),

      addImageElement: (src, alt = '업로드 이미지') =>
        set((state) => {
          const id = makeId('img');
          const slides = state.deck.slides.map((s) => {
            if (s.id !== state.activeSlideId) return s;
            const maxZ = s.elements.reduce((m, e) => Math.max(m, e.zIndex), 0);
            const newEl: SlideElement = {
              id,
              type: 'image',
              x: 240,
              y: 130,
              w: 360,
              h: 240,
              zIndex: maxZ + 1,
              src,
              alt,
              borderRadius: 8,
            };
            return { ...s, elements: [...s.elements, newEl] };
          });
          return {
            ...pushHistory(state, { ...state.deck, slides }),
            selectedElementId: id,
            activeTool: 'select',
          };
        }),

      addTableElement: (rows = 3, cols = 3) =>
        set((state) => {
          const id = makeId('tbl');
          const matrix = Array.from({ length: rows }, (_, r) =>
            Array.from({ length: cols }, (_, c) =>
              r === 0 ? `항목 ${c + 1}` : `내용 ${r}-${c + 1}`,
            ),
          );
          const slides = state.deck.slides.map((s) => {
            if (s.id !== state.activeSlideId) return s;
            const maxZ = s.elements.reduce((m, e) => Math.max(m, e.zIndex), 0);
            const newEl: SlideElement = {
              id,
              type: 'table',
              x: 160,
              y: 160,
              w: 520,
              h: 210,
              zIndex: maxZ + 1,
              rows: matrix,
              headerBg: '#1e3a8a',
              cellBg: '#ffffff',
              borderColor: '#cbd5e1',
              textColor: '#0f172a',
              fontSize: 15,
            };
            return { ...s, elements: [...s.elements, newEl] };
          });
          return {
            ...pushHistory(state, { ...state.deck, slides }),
            selectedElementId: id,
            activeTool: 'select',
          };
        }),

      updateElement: (elementId, patch, recordHistory = false) =>
        set((state) => {
          const slides = state.deck.slides.map((s) => {
            if (s.id !== state.activeSlideId) return s;
            return {
              ...s,
              elements: s.elements.map((el) =>
                el.id === elementId ? ({ ...el, ...patch } as SlideElement) : el,
              ),
            };
          });
          const nextDeck: DeckDocument = {
            ...state.deck,
            slides,
            updatedAt: Date.now(),
          };
          if (recordHistory) {
            return pushHistory(state, nextDeck);
          }
          scheduleDeckPersist(nextDeck);
          return { deck: nextDeck };
        }),

      commitSnapshotForUndo: (snapshotBeforeEdit) =>
        set((state) => {
          scheduleDeckPersist(state.deck);
          return {
            past: [...state.past.slice(-(MAX_HISTORY - 1)), snapshotBeforeEdit],
            future: [],
          };
        }),

      deleteElement: (elementId) =>
        set((state) => {
          const slides = state.deck.slides.map((s) => {
            if (s.id !== state.activeSlideId) return s;
            return {
              ...s,
              elements: s.elements.filter((el) => el.id !== elementId),
            };
          });
          return {
            ...pushHistory(state, { ...state.deck, slides }),
            selectedElementId:
              state.selectedElementId === elementId
                ? null
                : state.selectedElementId,
          };
        }),

      updateSlideBackground: (bg) =>
        set((state) => {
          const slides = state.deck.slides.map((s) =>
            s.id === state.activeSlideId
              ? { ...s, background: { ...s.background, ...bg } }
              : s,
          );
          return pushHistory(state, { ...state.deck, slides });
        }),

      updateSlideNotes: (notes) =>
        set((state) => {
          const slides = state.deck.slides.map((s) =>
            s.id === state.activeSlideId ? { ...s, notes } : s,
          );
          const nextDeck = { ...state.deck, slides, updatedAt: Date.now() };
          scheduleDeckPersist(nextDeck);
          return { deck: nextDeck };
        }),

      addInkStroke: (stroke) =>
        set((state) => {
          const slides = state.deck.slides.map((s) =>
            s.id === state.activeSlideId
              ? { ...s, strokes: [...s.strokes, stroke] }
              : s,
          );
          return pushHistory(state, { ...state.deck, slides });
        }),

      eraseStrokesByIds: (strokeIds) =>
        set((state) => {
          if (strokeIds.length === 0) return state;
          const idSet = new Set(strokeIds);
          const slides = state.deck.slides.map((s) =>
            s.id === state.activeSlideId
              ? { ...s, strokes: s.strokes.filter((st) => !idSet.has(st.id)) }
              : s,
          );
          return pushHistory(state, { ...state.deck, slides });
        }),

      clearSlideInk: () =>
        set((state) => {
          const active = state.deck.slides.find(
            (s) => s.id === state.activeSlideId,
          );
          if (!active || active.strokes.length === 0) return state;
          const slides = state.deck.slides.map((s) =>
            s.id === state.activeSlideId ? { ...s, strokes: [] } : s,
          );
          return pushHistory(state, { ...state.deck, slides });
        }),

      applyAiDesignPatch: (patch) =>
        set((state) => {
          const slides = state.deck.slides.map((s) => {
            if (s.id !== state.activeSlideId) return s;
            const nextBg: SlideBackground = patch.background
              ? {
                  color: patch.background.color || s.background.color || '#ffffff',
                  gradient: patch.background.gradient || undefined,
                  pattern: patch.background.pattern ?? 'none',
                }
              : s.background;
            return {
              ...s,
              title: patch.title ?? s.title,
              background: nextBg,
              elements: patch.elements ?? s.elements,
            };
          });
          return {
            ...pushHistory(state, { ...state.deck, slides }),
            selectedElementId: null,
          };
        }),

      undo: () =>
        set((state) => {
          if (state.past.length === 0) return state;
          const prev = state.past[state.past.length - 1];
          const nextPast = state.past.slice(0, -1);
          const nextFuture = [state.deck, ...state.future].slice(0, MAX_HISTORY);
          scheduleDeckPersist(prev);
          const activeExists = prev.slides.some(
            (s) => s.id === state.activeSlideId,
          );
          return {
            deck: prev,
            past: nextPast,
            future: nextFuture,
            activeSlideId: activeExists
              ? state.activeSlideId
              : prev.slides[0]?.id ?? '',
            selectedElementId: null,
          };
        }),

      redo: () =>
        set((state) => {
          if (state.future.length === 0) return state;
          const next = state.future[0];
          const nextFuture = state.future.slice(1);
          const nextPast = [...state.past, state.deck].slice(-MAX_HISTORY);
          scheduleDeckPersist(next);
          const activeExists = next.slides.some(
            (s) => s.id === state.activeSlideId,
          );
          return {
            deck: next,
            past: nextPast,
            future: nextFuture,
            activeSlideId: activeExists
              ? state.activeSlideId
              : next.slides[0]?.id ?? '',
            selectedElementId: null,
          };
        }),

      setAiModel: (aiProvider, aiModelId) => set({ aiProvider, aiModelId }),
      setAiStatus: (aiStatus, aiStatusDetail = '') =>
        set({ aiStatus, aiStatusDetail }),

      appendAiMessage: (msg) => {
        const id = makeId('msg');
        set((state) => ({
          aiMessages: [
            ...state.aiMessages.slice(-(MAX_CHAT_MESSAGES - 1)),
            { ...msg, id, createdAt: Date.now() },
          ],
        }));
        return id;
      },

      updateAiMessageContent: (id, content, extra) =>
        set((state) => ({
          aiMessages: state.aiMessages.map((m) =>
            m.id === id ? { ...m, content, ...(extra ?? {}) } : m,
          ),
        })),

      clearAiMessages: () => set({ aiMessages: [] }),
    }),
    {
      name: 'incarvas-ai-chat-persist-v1',
      partialize: (state) => ({
        aiProvider: state.aiProvider,
        aiModelId: state.aiModelId,
        aiMessages: state.aiMessages,
      }),
    },
  ),
);

export function getActiveSlide(): Slide {
  const { deck, activeSlideId } = useDeckStore.getState();
  return (
    deck.slides.find((s) => s.id === activeSlideId) ?? deck.slides[0]
  );
}
