import React from 'react';
import { Copy, Plus, Trash2 } from 'lucide-react';
import { useDeckStore } from '../store/useDeckStore';
import { SLIDE_HEIGHT, SLIDE_WIDTH } from '../types/slide';

export const SlideList: React.FC = () => {
  const slides = useDeckStore((s) => s.deck.slides);
  const activeSlideId = useDeckStore((s) => s.activeSlideId);
  const setActiveSlide = useDeckStore((s) => s.setActiveSlide);
  const addSlide = useDeckStore((s) => s.addSlide);
  const duplicateSlide = useDeckStore((s) => s.duplicateSlide);
  const deleteSlide = useDeckStore((s) => s.deleteSlide);

  return (
    <aside
      aria-label="슬라이드 목록"
      className="flex h-full w-48 shrink-0 flex-col border-r border-slate-200 bg-white sm:w-56"
    >
      <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2.5">
        <span className="text-xs font-semibold tracking-wide text-slate-600">
          슬라이드 ({slides.length})
        </span>
        <button
          type="button"
          onClick={addSlide}
          className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-2.5 py-1.5 text-xs font-semibold text-white shadow-xs active:scale-95"
        >
          <Plus className="h-3.5 w-3.5" />
          추가
        </button>
      </div>

      <div className="flex-1 space-y-2.5 overflow-y-auto p-2.5">
        {slides.map((slide, idx) => {
          const isActive = slide.id === activeSlideId;
          return (
            <div
              key={slide.id}
              onClick={() => setActiveSlide(slide.id)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setActiveSlide(slide.id);
                }
              }}
              className={`group relative cursor-pointer rounded-xl border p-1.5 transition ${
                isActive
                  ? 'border-blue-600 bg-blue-50/70 ring-2 ring-blue-500/30'
                  : 'border-slate-200 bg-slate-50 hover:border-slate-300'
              }`}
            >
              <div className="mb-1 flex items-center justify-between px-1">
                <span className="text-[11px] font-bold text-slate-600">
                  {idx + 1}. {slide.title}
                </span>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    aria-label="슬라이드 복제"
                    onClick={(e) => {
                      e.stopPropagation();
                      duplicateSlide(slide.id);
                    }}
                    className="rounded p-1 text-slate-500 opacity-90 hover:bg-slate-200 hover:text-slate-800"
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </button>
                  {slides.length > 1 && (
                    <button
                      type="button"
                      aria-label="슬라이드 삭제"
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteSlide(slide.id);
                      }}
                      className="rounded p-1 text-rose-500 opacity-90 hover:bg-rose-100 hover:text-rose-700"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </div>

              <div
                className="relative w-full overflow-hidden rounded-lg border border-slate-200 shadow-2xs"
                style={{
                  aspectRatio: '16 / 9',
                  background:
                    slide.background.gradient || slide.background.color || '#ffffff',
                }}
              >
                <div
                  className="pointer-events-none origin-top-left"
                  style={{
                    width: SLIDE_WIDTH,
                    height: SLIDE_HEIGHT,
                    transform: 'scale(0.18)',
                  }}
                >
                  {slide.elements.map((el) => (
                    <div
                      key={el.id}
                      style={{
                        position: 'absolute',
                        left: el.x,
                        top: el.y,
                        width: el.w,
                        height: el.h,
                        overflow: 'hidden',
                      }}
                    >
                      {el.type === 'text' && (
                        <div
                          style={{
                            fontSize: el.fontSize,
                            color: el.color,
                            fontWeight: el.bold ? 700 : 400,
                            textAlign: el.align,
                            backgroundColor: el.backgroundColor,
                          }}
                        >
                          {el.text}
                        </div>
                      )}
                      {el.type === 'shape' && (
                        <div
                          style={{
                            width: '100%',
                            height: '100%',
                            backgroundColor: el.fill,
                            border: `${el.strokeWidth}px solid ${el.stroke}`,
                            borderRadius:
                              el.shapeKind === 'ellipse'
                                ? '9999px'
                                : el.shapeKind === 'roundedRect'
                                  ? '14px'
                                  : '0px',
                          }}
                        />
                      )}
                      {el.type === 'image' && (
                        <img
                          src={el.src}
                          alt={el.alt || ''}
                          className="h-full w-full object-cover"
                        />
                      )}
                      {el.type === 'table' && (
                        <div className="h-full w-full border border-slate-400 bg-white/80" />
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="border-t border-slate-200 p-2.5">
        <button
          type="button"
          onClick={addSlide}
          className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-slate-300 py-2 text-xs font-medium text-slate-600 hover:border-blue-400 hover:bg-blue-50 hover:text-blue-700"
        >
          <Plus className="h-4 w-4" />새 슬라이드 추가
        </button>
      </div>
    </aside>
  );
};
