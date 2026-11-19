import React, { useEffect, useRef } from 'react';
import type { EditorTool, InkPoint, InkStroke } from '../types/slide';
import { SLIDE_HEIGHT, SLIDE_WIDTH } from '../types/slide';
import {
  drawIncrementalStrokeSegment,
  drawStroke,
  isPointNearStroke,
} from '../utils/strokeRenderer';

const PALM_REJECTION_WINDOW_MS = 450;

interface StylusOverlayProps {
  slideId: string;
  strokes: InkStroke[];
  activeTool: EditorTool;
  penColor: string;
  penWidth: number;
  scale: number;
  onAddStroke: (stroke: InkStroke) => void;
  onEraseStrokes: (strokeIds: string[]) => void;
}

export const StylusOverlay: React.FC<StylusOverlayProps> = ({
  slideId,
  strokes,
  activeTool,
  penColor,
  penWidth,
  scale,
  onAddStroke,
  onEraseStrokes,
}) => {
  const committedRef = useRef<HTMLCanvasElement | null>(null);
  const activeRef = useRef<HTMLCanvasElement | null>(null);
  const interactionRef = useRef<HTMLCanvasElement | null>(null);
  const initializedSizeRef = useRef(false);

  const isInkMode =
    activeTool === 'pen' ||
    activeTool === 'highlighter' ||
    activeTool === 'eraser';

  const activePointsRef = useRef<InkPoint[]>([]);
  const activePointerIdRef = useRef<number | null>(null);
  const lastPenTimestampRef = useRef<number>(0);
  const strokesRef = useRef<InkStroke[]>(strokes);
  strokesRef.current = strokes;

  useEffect(() => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const targetW = Math.round(SLIDE_WIDTH * dpr);
    const targetH = Math.round(SLIDE_HEIGHT * dpr);

    if (!initializedSizeRef.current) {
      [committedRef.current, activeRef.current, interactionRef.current].forEach(
        (canvas) => {
          if (!canvas) return;
          if (canvas.width !== targetW || canvas.height !== targetH) {
            canvas.width = targetW;
            canvas.height = targetH;
          }
        },
      );
      initializedSizeRef.current = true;
    }

    const committed = committedRef.current;
    if (!committed) return;
    const ctx = committed.getContext('2d');
    if (!ctx) return;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, committed.width, committed.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    for (const stroke of strokes) {
      drawStroke(ctx, stroke);
    }
  }, [slideId, strokes]);

  const toSlidePoint = (
    clientX: number,
    clientY: number,
    pressure: number,
  ): InkPoint => {
    const rect = activeRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) {
      return { x: 0, y: 0, pressure: pressure || 0.5 };
    }
    const x = ((clientX - rect.left) / rect.width) * SLIDE_WIDTH;
    const y = ((clientY - rect.top) / rect.height) * SLIDE_HEIGHT;
    return {
      x: Math.max(0, Math.min(SLIDE_WIDTH, x)),
      y: Math.max(0, Math.min(SLIDE_HEIGHT, y)),
      pressure: pressure > 0 ? pressure : 0.5,
    };
  };

  const clearInteractionOverlay = () => {
    const canvas = interactionRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  };

  const drawEraserCursor = (x: number, y: number) => {
    const canvas = interactionRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = canvas.width / SLIDE_WIDTH;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.beginPath();
    ctx.arc(x, y, 14, 0, Math.PI * 2);
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 3]);
    ctx.stroke();
  };

  const clearActiveCanvas = () => {
    const active = activeRef.current;
    if (!active) return;
    const ctx = active.getContext('2d', { desynchronized: true });
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, active.width, active.height);
  };

  const commitActiveStroke = () => {
    const pts = activePointsRef.current;
    activePointsRef.current = [];
    activePointerIdRef.current = null;

    if (pts.length === 0 || (activeTool !== 'pen' && activeTool !== 'highlighter')) {
      clearActiveCanvas();
      return;
    }

    const stroke: InkStroke = {
      id: `ink-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      points: pts,
      color: penColor,
      width: activeTool === 'highlighter' ? Math.max(14, penWidth * 4) : penWidth,
      tool: activeTool,
    };

    const committed = committedRef.current;
    const active = activeRef.current;
    if (committed && active) {
      const cCtx = committed.getContext('2d');
      if (cCtx) {
        cCtx.setTransform(1, 0, 0, 1, 0, 0);
        cCtx.drawImage(active, 0, 0);
      }
    }

    requestAnimationFrame(() => {
      clearActiveCanvas();
    });

    onAddStroke(stroke);
  };

  const isEraserPointer = (e: React.PointerEvent<HTMLCanvasElement>) =>
    activeTool === 'eraser' ||
    (e.pointerType as string) === 'eraser' ||
    e.buttons === 32;

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isInkMode && !isEraserPointer(e)) return;

    const now = performance.now();
    if (e.pointerType === 'pen') {
      lastPenTimestampRef.current = now;
    } else if (
      e.pointerType === 'touch' &&
      now - lastPenTimestampRef.current < PALM_REJECTION_WINDOW_MS
    ) {
      return;
    }

    e.preventDefault();
    e.stopPropagation();

    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);
    activePointerIdRef.current = e.pointerId;

    const pt = toSlidePoint(e.clientX, e.clientY, e.pressure);

    if (isEraserPointer(e)) {
      drawEraserCursor(pt.x, pt.y);
      const hitIds = strokesRef.current
        .filter((st) => isPointNearStroke(pt.x, pt.y, st))
        .map((st) => st.id);
      if (hitIds.length > 0) {
        onEraseStrokes(hitIds);
      }
      return;
    }

    clearActiveCanvas();
    activePointsRef.current = [pt];

    const active = activeRef.current;
    if (!active) return;
    const ctx = active.getContext('2d', { desynchronized: true });
    if (!ctx) return;
    const dpr = active.width / SLIDE_WIDTH;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawIncrementalStrokeSegment(
      ctx,
      activePointsRef.current,
      0,
      penColor,
      activeTool === 'highlighter' ? Math.max(14, penWidth * 4) : penWidth,
      activeTool === 'highlighter' ? 'highlighter' : 'pen',
    );
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isInkMode || activePointerIdRef.current !== e.pointerId) return;

    if (e.pointerType === 'pen') {
      lastPenTimestampRef.current = performance.now();
    }

    e.preventDefault();
    e.stopPropagation();

    if (isEraserPointer(e)) {
      const pt = toSlidePoint(e.clientX, e.clientY, e.pressure);
      drawEraserCursor(pt.x, pt.y);
      const hitIds = strokesRef.current
        .filter((st) => isPointNearStroke(pt.x, pt.y, st))
        .map((st) => st.id);
      if (hitIds.length > 0) {
        onEraseStrokes(hitIds);
      }
      return;
    }

    const nativeEvent = e.nativeEvent as PointerEvent;
    const coalesced =
      typeof nativeEvent.getCoalescedEvents === 'function'
        ? nativeEvent.getCoalescedEvents()
        : [nativeEvent];

    const prevLen = activePointsRef.current.length;
    const minDelta = 0.35 / Math.max(0.25, scale);

    for (const ev of coalesced) {
      const pt = toSlidePoint(ev.clientX, ev.clientY, ev.pressure);
      const last = activePointsRef.current[activePointsRef.current.length - 1];
      if (!last || Math.hypot(pt.x - last.x, pt.y - last.y) >= minDelta) {
        activePointsRef.current.push(pt);
      }
    }

    if (activePointsRef.current.length === prevLen) return;

    const active = activeRef.current;
    if (!active) return;
    const ctx = active.getContext('2d', { desynchronized: true });
    if (!ctx) return;
    const dpr = active.width / SLIDE_WIDTH;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawIncrementalStrokeSegment(
      ctx,
      activePointsRef.current,
      Math.max(1, prevLen - 1),
      penColor,
      activeTool === 'highlighter' ? Math.max(14, penWidth * 4) : penWidth,
      activeTool === 'highlighter' ? 'highlighter' : 'pen',
    );
  };

  const handlePointerEnd = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (activePointerIdRef.current !== e.pointerId) return;
    if (e.pointerType === 'pen') {
      lastPenTimestampRef.current = performance.now();
    }
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    clearInteractionOverlay();
    if (isEraserPointer(e)) {
      activePointerIdRef.current = null;
      return;
    }
    commitActiveStroke();
  };

  return (
    <div
      className={`slide-canvas-surface absolute inset-0 ${
        isInkMode ? 'pointer-events-auto cursor-crosshair' : 'pointer-events-none'
      }`}
      style={{ zIndex: 30 }}
    >
      <canvas
        ref={committedRef}
        className="pointer-events-none absolute inset-0 h-full w-full"
        style={{ zIndex: 30 }}
      />
      <canvas
        ref={activeRef}
        className="pointer-events-none absolute inset-0 h-full w-full"
        style={{ zIndex: 31 }}
      />
      <canvas
        ref={interactionRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerEnd}
        onPointerCancel={handlePointerEnd}
        className="slide-canvas-surface absolute inset-0 h-full w-full"
        style={{ zIndex: 32 }}
      />
    </div>
  );
};
