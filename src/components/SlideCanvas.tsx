import React, { useEffect, useRef, useState } from 'react';
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  Trash2,
} from 'lucide-react';
import { useDeckStore } from '../store/useDeckStore';
import type {
  DeckDocument,
  ShapeElement,
  SlideElement,
  TextElement,
} from '../types/slide';
import { SLIDE_HEIGHT, SLIDE_WIDTH } from '../types/slide';
import { focusWithoutScroll, isImeComposing } from '../utils/koreanIme';
import { StylusOverlay } from './StylusOverlay';

interface DragState {
  mode: 'move' | 'resize';
  elementId: string;
  startClientX: number;
  startClientY: number;
  origX: number;
  origY: number;
  origW: number;
  origH: number;
  snapshot: DeckDocument;
}

export const SlideCanvas: React.FC = () => {
  const deck = useDeckStore((s) => s.deck);
  const activeSlideId = useDeckStore((s) => s.activeSlideId);
  const selectedElementId = useDeckStore((s) => s.selectedElementId);
  const activeTool = useDeckStore((s) => s.activeTool);
  const penColor = useDeckStore((s) => s.penColor);
  const penWidth = useDeckStore((s) => s.penWidth);

  const setSelectedElementId = useDeckStore((s) => s.setSelectedElementId);
  const updateElement = useDeckStore((s) => s.updateElement);
  const commitSnapshotForUndo = useDeckStore((s) => s.commitSnapshotForUndo);
  const deleteElement = useDeckStore((s) => s.deleteElement);
  const addTextElement = useDeckStore((s) => s.addTextElement);
  const addShapeElement = useDeckStore((s) => s.addShapeElement);
  const addTableElement = useDeckStore((s) => s.addTableElement);
  const addInkStroke = useDeckStore((s) => s.addInkStroke);
  const eraseStrokesByIds = useDeckStore((s) => s.eraseStrokesByIds);
  const updateSlideNotes = useDeckStore((s) => s.updateSlideNotes);

  const activeSlide =
    deck.slides.find((s) => s.id === activeSlideId) ?? deck.slides[0];

  const containerRef = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(0.8);
  const [editingId, setEditingId] = useState<string | null>(null);
  const dragRef = useRef<DragState | null>(null);

  useEffect(() => {
    const updateScale = () => {
      const container = containerRef.current;
      if (!container) return;
      const padX = 32;
      const padY = 32;
      const availW = Math.max(260, container.clientWidth - padX);
      const availH = Math.max(180, container.clientHeight - padY);
      const next = Math.min(availW / SLIDE_WIDTH, availH / SLIDE_HEIGHT, 1.25);
      setScale(Math.max(0.28, next));
    };

    updateScale();
    const ro = new ResizeObserver(updateScale);
    if (containerRef.current) ro.observe(containerRef.current);

    let reflowTimer: number | null = null;
    const onViewportChange = () => {
      if (reflowTimer) window.clearTimeout(reflowTimer);
      reflowTimer = window.setTimeout(updateScale, 120);
    };
    window.addEventListener('orientationchange', onViewportChange);
    window.visualViewport?.addEventListener('resize', onViewportChange);

    return () => {
      ro.disconnect();
      if (reflowTimer) window.clearTimeout(reflowTimer);
      window.removeEventListener('orientationchange', onViewportChange);
      window.visualViewport?.removeEventListener('resize', onViewportChange);
    };
  }, []);

  useEffect(() => {
    setEditingId(null);
  }, [activeSlideId]);

  const selectedElement = activeSlide.elements.find(
    (el) => el.id === selectedElementId,
  );

  const handleCanvasBackgroundClick = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    setEditingId(null);

    const rect = e.currentTarget.getBoundingClientRect();
    const x = Math.round(((e.clientX - rect.left) / rect.width) * SLIDE_WIDTH);
    const y = Math.round(((e.clientY - rect.top) / rect.height) * SLIDE_HEIGHT);

    if (activeTool === 'text') {
      addTextElement(Math.min(x, SLIDE_WIDTH - 240), Math.min(y, SLIDE_HEIGHT - 80));
      return;
    }
    if (
      activeTool === 'rect' ||
      activeTool === 'roundedRect' ||
      activeTool === 'ellipse' ||
      activeTool === 'triangle' ||
      activeTool === 'arrowRight'
    ) {
      addShapeElement(
        activeTool,
        Math.min(x, SLIDE_WIDTH - 200),
        Math.min(y, SLIDE_HEIGHT - 120),
      );
      return;
    }
    if (activeTool === 'table') {
      addTableElement(3, 3);
      return;
    }
    setSelectedElementId(null);
  };

  const startDrag = (
    e: React.PointerEvent,
    el: SlideElement,
    mode: 'move' | 'resize',
  ) => {
    if (activeTool !== 'select' || editingId === el.id) return;
    e.stopPropagation();
    setSelectedElementId(el.id);

    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);

    dragRef.current = {
      mode,
      elementId: el.id,
      startClientX: e.clientX,
      startClientY: e.clientY,
      origX: el.x,
      origY: el.y,
      origW: el.w,
      origH: el.h,
      snapshot: structuredClone(useDeckStore.getState().deck),
    };
  };

  const moveDrag = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    e.stopPropagation();

    const dx = (e.clientX - drag.startClientX) / scale;
    const dy = (e.clientY - drag.startClientY) / scale;

    if (drag.mode === 'move') {
      const nx = Math.max(0, Math.min(SLIDE_WIDTH - drag.origW, drag.origX + dx));
      const ny = Math.max(0, Math.min(SLIDE_HEIGHT - drag.origH, drag.origY + dy));
      updateElement(drag.elementId, { x: Math.round(nx), y: Math.round(ny) }, false);
    } else {
      const nw = Math.max(48, Math.min(SLIDE_WIDTH - drag.origX, drag.origW + dx));
      const nh = Math.max(32, Math.min(SLIDE_HEIGHT - drag.origY, drag.origH + dy));
      updateElement(drag.elementId, { w: Math.round(nw), h: Math.round(nh) }, false);
    }
  };

  const endDrag = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    dragRef.current = null;
    const target = e.currentTarget as HTMLElement;
    if (target.hasPointerCapture(e.pointerId)) {
      target.releasePointerCapture(e.pointerId);
    }
    const moved =
      Math.abs(e.clientX - drag.startClientX) > 2 ||
      Math.abs(e.clientY - drag.startClientY) > 2;
    if (moved) {
      commitSnapshotForUndo(drag.snapshot);
    }
  };

  const patternClass =
    activeSlide.background.pattern === 'grid'
      ? 'slide-pattern-grid'
      : activeSlide.background.pattern === 'dots'
        ? 'slide-pattern-dots'
        : activeSlide.background.pattern === 'lined'
          ? 'slide-pattern-lined'
          : '';

  return (
    <div className="flex min-w-0 flex-1 flex-col bg-slate-100">
      {/* 선택된 요소 속성 바 (호버 없이 상시 노출) */}
      <div className="flex min-h-11 flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-3 py-1.5 text-xs">
        {selectedElement ? (
          <>
            <span className="rounded bg-blue-50 px-2 py-0.5 font-semibold text-blue-700">
              {selectedElement.type === 'text'
                ? '텍스트'
                : selectedElement.type === 'shape'
                  ? '도형'
                  : selectedElement.type === 'table'
                    ? '표'
                    : '이미지'}
            </span>

            {selectedElement.type === 'text' && (
              <>
                <label className="flex items-center gap-1 text-slate-600">
                  크기
                  <input
                    type="number"
                    min={11}
                    max={72}
                    value={selectedElement.fontSize}
                    onChange={(e) =>
                      updateElement(
                        selectedElement.id,
                        { fontSize: Number(e.target.value) || 18 },
                        true,
                      )
                    }
                    className="w-14 rounded border border-slate-300 px-1.5 py-0.5 text-xs"
                  />
                </label>
                <label className="flex items-center gap-1 text-slate-600">
                  글자색
                  <input
                    type="color"
                    value={selectedElement.color}
                    onChange={(e) =>
                      updateElement(
                        selectedElement.id,
                        { color: e.target.value },
                        true,
                      )
                    }
                    className="h-6 w-7 cursor-pointer rounded border border-slate-300"
                  />
                </label>
                <button
                  type="button"
                  onClick={() =>
                    updateElement(
                      selectedElement.id,
                      { bold: !selectedElement.bold },
                      true,
                    )
                  }
                  className={`rounded border px-2 py-1 ${
                    selectedElement.bold
                      ? 'border-blue-600 bg-blue-50 text-blue-700'
                      : 'border-slate-300 text-slate-700'
                  }`}
                >
                  <Bold className="h-3.5 w-3.5" />
                </button>
                <div className="flex overflow-hidden rounded border border-slate-300">
                  {(['left', 'center', 'right'] as const).map((al) => (
                    <button
                      key={al}
                      type="button"
                      onClick={() =>
                        updateElement(selectedElement.id, { align: al }, true)
                      }
                      className={`p-1 ${
                        selectedElement.align === al
                          ? 'bg-blue-600 text-white'
                          : 'bg-white text-slate-600'
                      }`}
                    >
                      {al === 'left' ? (
                        <AlignLeft className="h-3.5 w-3.5" />
                      ) : al === 'center' ? (
                        <AlignCenter className="h-3.5 w-3.5" />
                      ) : (
                        <AlignRight className="h-3.5 w-3.5" />
                      )}
                    </button>
                  ))}
                </div>
              </>
            )}

            {selectedElement.type === 'shape' && (
              <>
                <label className="flex items-center gap-1 text-slate-600">
                  채우기
                  <input
                    type="color"
                    value={selectedElement.fill}
                    onChange={(e) =>
                      updateElement(
                        selectedElement.id,
                        { fill: e.target.value },
                        true,
                      )
                    }
                    className="h-6 w-7 cursor-pointer rounded border border-slate-300"
                  />
                </label>
                <label className="flex items-center gap-1 text-slate-600">
                  테두리
                  <input
                    type="color"
                    value={selectedElement.stroke}
                    onChange={(e) =>
                      updateElement(
                        selectedElement.id,
                        { stroke: e.target.value },
                        true,
                      )
                    }
                    className="h-6 w-7 cursor-pointer rounded border border-slate-300"
                  />
                </label>
              </>
            )}

            <button
              type="button"
              onClick={() => deleteElement(selectedElement.id)}
              className="ml-auto inline-flex items-center gap-1 rounded-lg bg-rose-50 px-2.5 py-1 font-medium text-rose-700 hover:bg-rose-100"
            >
              <Trash2 className="h-3.5 w-3.5" />
              삭제
            </button>
          </>
        ) : (
          <span className="text-slate-500">
            요소를 클릭해 드래그/크기 조절하거나, 더블 클릭(더블 탭)해 텍스트를 수정하세요. 펜 도구로 스케치도 가능합니다.
          </span>
        )}
      </div>

      {/* 중앙 16:9 슬라이드 작업 영역 */}
      <div
        ref={containerRef}
        className="flex flex-1 items-center justify-center overflow-hidden p-4"
      >
        <div
          style={{
            width: SLIDE_WIDTH * scale,
            height: SLIDE_HEIGHT * scale,
          }}
          className="relative shrink-0 shadow-xl ring-1 ring-slate-300"
        >
          <div
            onPointerDown={handleCanvasBackgroundClick}
            className={`slide-canvas-surface relative origin-top-left overflow-hidden ${patternClass}`}
            style={{
              width: SLIDE_WIDTH,
              height: SLIDE_HEIGHT,
              transform: `scale(${scale})`,
              backgroundColor: activeSlide.background.color || '#ffffff',
              backgroundImage: activeSlide.background.gradient || undefined,
            }}
          >
            {activeSlide.elements
              .slice()
              .sort((a, b) => a.zIndex - b.zIndex)
              .map((el) => {
                const isSelected = el.id === selectedElementId;
                const isEditing = el.id === editingId;

                return (
                  <div
                    key={el.id}
                    onPointerDown={(e) => startDrag(e, el, 'move')}
                    onPointerMove={moveDrag}
                    onPointerUp={endDrag}
                    onPointerCancel={endDrag}
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      if (el.type === 'text' || el.type === 'shape') {
                        setSelectedElementId(el.id);
                        setEditingId(el.id);
                      }
                    }}
                    style={{
                      position: 'absolute',
                      left: el.x,
                      top: el.y,
                      width: el.w,
                      height: el.h,
                      zIndex: el.zIndex,
                      opacity: el.opacity ?? 1,
                    }}
                    className={`select-none ${
                      isSelected
                        ? 'ring-2 ring-blue-600 ring-offset-1'
                        : 'hover:ring-1 hover:ring-blue-400/60'
                    }`}
                  >
                    {el.type === 'text' && (
                      <TextBoxItem
                        el={el}
                        isEditing={isEditing}
                        onCommit={(text) => {
                          updateElement(el.id, { text }, true);
                          setEditingId(null);
                        }}
                      />
                    )}

                    {el.type === 'shape' && (
                      <ShapeBoxItem
                        el={el}
                        isEditing={isEditing}
                        onCommitText={(text) => {
                          updateElement(el.id, { text }, true);
                          setEditingId(null);
                        }}
                      />
                    )}

                    {el.type === 'image' && (
                      <img
                        src={el.src}
                        alt={el.alt || '슬라이드 이미지'}
                        draggable={false}
                        className="h-full w-full object-cover"
                        style={{ borderRadius: el.borderRadius ?? 8 }}
                      />
                    )}

                    {el.type === 'table' && (
                      <table
                        className="h-full w-full border-collapse table-fixed"
                        style={{ fontSize: el.fontSize }}
                      >
                        <tbody>
                          {el.rows.map((row, rIdx) => (
                            <tr key={rIdx}>
                              {row.map((cell, cIdx) => (
                                <td
                                  key={cIdx}
                                  style={{
                                    backgroundColor:
                                      rIdx === 0 ? el.headerBg : el.cellBg,
                                    color:
                                      rIdx === 0 ? '#ffffff' : el.textColor,
                                    borderColor: el.borderColor,
                                  }}
                                  className="border p-1 text-center"
                                >
                                  <input
                                    type="text"
                                    lang="ko"
                                    value={cell}
                                    onPointerDown={(ev) => ev.stopPropagation()}
                                    onChange={(ev) => {
                                      const nextRows = el.rows.map((r, ri) =>
                                        ri === rIdx
                                          ? r.map((c, ci) =>
                                              ci === cIdx ? ev.target.value : c,
                                            )
                                          : r,
                                      );
                                      updateElement(
                                        el.id,
                                        { rows: nextRows },
                                        false,
                                      );
                                    }}
                                    className="w-full bg-transparent text-center outline-none"
                                  />
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}

                    {isSelected && activeTool === 'select' && !isEditing && (
                      <div
                        data-overlay="resize-handle"
                        onPointerDown={(e) => startDrag(e, el, 'resize')}
                        onPointerMove={moveDrag}
                        onPointerUp={endDrag}
                        onPointerCancel={endDrag}
                        className="absolute -right-2 -bottom-2 h-4 w-4 cursor-nwse-resize rounded-full border-2 border-white bg-blue-600 shadow"
                      />
                    )}
                  </div>
                );
              })}

            <StylusOverlay
              slideId={activeSlide.id}
              strokes={activeSlide.strokes}
              activeTool={activeTool}
              penColor={penColor}
              penWidth={penWidth}
              scale={scale}
              onAddStroke={addInkStroke}
              onEraseStrokes={eraseStrokesByIds}
            />
          </div>
        </div>
      </div>

      {/* 발표자 노트 */}
      <div className="border-t border-slate-200 bg-white px-4 py-2">
        <input
          type="text"
          lang="ko"
          inputMode="text"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          value={activeSlide.notes ?? ''}
          onChange={(e) => updateSlideNotes(e.target.value)}
          placeholder="발표자 노트 (PPTX 내보내기 시 포함됩니다)"
          className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs text-slate-700 outline-none focus:border-blue-500 focus:bg-white"
        />
      </div>
    </div>
  );
};

const TextBoxItem: React.FC<{
  el: TextElement;
  isEditing: boolean;
  onCommit: (nextText: string) => void;
}> = ({ el, isEditing, onCommit }) => {
  const [draft, setDraft] = useState(el.text);
  const ref = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    setDraft(el.text);
  }, [el.text]);

  useEffect(() => {
    if (isEditing && ref.current) {
      focusWithoutScroll(ref.current);
    }
  }, [isEditing]);

  if (isEditing) {
    return (
      <textarea
        ref={ref}
        lang="ko"
        inputMode="text"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        value={draft}
        onPointerDown={(e) => e.stopPropagation()}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => onCommit(draft)}
        onKeyDown={(e) => {
          if (isImeComposing(e)) return;
          if (e.key === 'Escape') {
            e.preventDefault();
            onCommit(draft);
          }
        }}
        style={{
          fontSize: el.fontSize,
          fontFamily: el.fontFamily,
          color: el.color,
          fontWeight: el.bold ? 700 : 400,
          fontStyle: el.italic ? 'italic' : 'normal',
          textAlign: el.align,
          backgroundColor: el.backgroundColor || 'rgba(255,255,255,0.92)',
          borderRadius: el.borderRadius ?? 6,
          padding: el.padding ?? 8,
        }}
        className="h-full w-full resize-none border border-blue-500 outline-none"
      />
    );
  }

  return (
    <div
      style={{
        fontSize: el.fontSize,
        fontFamily: el.fontFamily,
        color: el.color,
        fontWeight: el.bold ? 700 : 400,
        fontStyle: el.italic ? 'italic' : 'normal',
        textAlign: el.align,
        backgroundColor: el.backgroundColor,
        borderRadius: el.borderRadius ?? 6,
        padding: el.padding ?? 8,
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
      }}
      className="h-full w-full overflow-hidden leading-snug"
    >
      {el.text}
    </div>
  );
};

const ShapeBoxItem: React.FC<{
  el: ShapeElement;
  isEditing: boolean;
  onCommitText: (text: string) => void;
}> = ({ el, isEditing, onCommitText }) => {
  const [draft, setDraft] = useState(el.text ?? '');
  const ref = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setDraft(el.text ?? '');
  }, [el.text]);

  useEffect(() => {
    if (isEditing && ref.current) {
      focusWithoutScroll(ref.current);
    }
  }, [isEditing]);

  return (
    <div className="relative flex h-full w-full items-center justify-center">
      <svg
        viewBox={`0 0 ${el.w} ${el.h}`}
        className="pointer-events-none absolute inset-0 h-full w-full"
        preserveAspectRatio="none"
      >
        {el.shapeKind === 'rect' && (
          <rect
            x={el.strokeWidth / 2}
            y={el.strokeWidth / 2}
            width={Math.max(1, el.w - el.strokeWidth)}
            height={Math.max(1, el.h - el.strokeWidth)}
            fill={el.fill}
            stroke={el.stroke}
            strokeWidth={el.strokeWidth}
          />
        )}
        {el.shapeKind === 'roundedRect' && (
          <rect
            x={el.strokeWidth / 2}
            y={el.strokeWidth / 2}
            width={Math.max(1, el.w - el.strokeWidth)}
            height={Math.max(1, el.h - el.strokeWidth)}
            rx={14}
            fill={el.fill}
            stroke={el.stroke}
            strokeWidth={el.strokeWidth}
          />
        )}
        {el.shapeKind === 'ellipse' && (
          <ellipse
            cx={el.w / 2}
            cy={el.h / 2}
            rx={Math.max(1, el.w / 2 - el.strokeWidth)}
            ry={Math.max(1, el.h / 2 - el.strokeWidth)}
            fill={el.fill}
            stroke={el.stroke}
            strokeWidth={el.strokeWidth}
          />
        )}
        {el.shapeKind === 'triangle' && (
          <polygon
            points={`${el.w / 2},${el.strokeWidth} ${el.w - el.strokeWidth},${el.h - el.strokeWidth} ${el.strokeWidth},${el.h - el.strokeWidth}`}
            fill={el.fill}
            stroke={el.stroke}
            strokeWidth={el.strokeWidth}
          />
        )}
        {el.shapeKind === 'arrowRight' && (
          <polygon
            points={`0,${el.h * 0.25} ${Math.max(20, el.w - Math.min(el.w * 0.35, 42))},${el.h * 0.25} ${Math.max(20, el.w - Math.min(el.w * 0.35, 42))},0 ${el.w},${el.h / 2} ${Math.max(20, el.w - Math.min(el.w * 0.35, 42))},${el.h} ${Math.max(20, el.w - Math.min(el.w * 0.35, 42))},${el.h * 0.75} 0,${el.h * 0.75}`}
            fill={el.fill}
            stroke={el.stroke}
            strokeWidth={el.strokeWidth}
          />
        )}
        {el.shapeKind === 'line' && (
          <line
            x1={0}
            y1={el.h / 2}
            x2={el.w}
            y2={el.h / 2}
            stroke={el.stroke}
            strokeWidth={Math.max(2, el.strokeWidth)}
          />
        )}
      </svg>

      {isEditing ? (
        <input
          ref={ref}
          type="text"
          lang="ko"
          inputMode="text"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          value={draft}
          onPointerDown={(e) => e.stopPropagation()}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => onCommitText(draft)}
          onKeyDown={(e) => {
            if (isImeComposing(e)) return;
            if (e.key === 'Enter' || e.key === 'Escape') {
              e.preventDefault();
              onCommitText(draft);
            }
          }}
          style={{
            color: el.textColor ?? '#0f172a',
            fontSize: el.fontSize ?? 16,
          }}
          className="relative z-10 w-4/5 rounded bg-white/90 px-2 py-1 text-center font-semibold outline-none ring-1 ring-blue-500"
        />
      ) : (
        el.text && (
          <span
            style={{
              color: el.textColor ?? '#0f172a',
              fontSize: el.fontSize ?? 16,
            }}
            className="relative z-10 px-2 text-center font-semibold"
          >
            {el.text}
          </span>
        )
      )}
    </div>
  );
};
