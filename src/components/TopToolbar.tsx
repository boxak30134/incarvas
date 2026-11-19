import React, { useRef, useState } from 'react';
import {
  ArrowRight,
  Circle,
  Cloud,
  Download,
  Eraser,
  FileText,
  Highlighter,
  Image as ImageIcon,
  MousePointer2,
  PanelRightClose,
  PanelRightOpen,
  Pen,
  Redo2,
  Square,
  Table,
  Trash2,
  Triangle,
  Type,
  Undo2,
} from 'lucide-react';
import { exportDeckToPdf, exportDeckToPptx } from '../services/exportService';
import { useDeckStore } from '../store/useDeckStore';
import type { EditorTool } from '../types/slide';
import { isImeComposing } from '../utils/koreanIme';

interface TopToolbarProps {
  showAiPanel: boolean;
  onToggleAiPanel: () => void;
  onOpenSettings: (tab?: 'ai' | 'drive') => void;
}

export const TopToolbar: React.FC<TopToolbarProps> = ({
  showAiPanel,
  onToggleAiPanel,
  onOpenSettings,
}) => {
  const deck = useDeckStore((s) => s.deck);
  const activeTool = useDeckStore((s) => s.activeTool);
  const penColor = useDeckStore((s) => s.penColor);
  const pastCount = useDeckStore((s) => s.past.length);
  const futureCount = useDeckStore((s) => s.future.length);

  const setDeckTitle = useDeckStore((s) => s.setDeckTitle);
  const setActiveTool = useDeckStore((s) => s.setActiveTool);
  const setPenColor = useDeckStore((s) => s.setPenColor);
  const addTextElement = useDeckStore((s) => s.addTextElement);
  const addShapeElement = useDeckStore((s) => s.addShapeElement);
  const addImageElement = useDeckStore((s) => s.addImageElement);
  const addTableElement = useDeckStore((s) => s.addTableElement);
  const clearSlideInk = useDeckStore((s) => s.clearSlideInk);
  const undo = useDeckStore((s) => s.undo);
  const redo = useDeckStore((s) => s.redo);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [exporting, setExporting] = useState<'pptx' | 'pdf' | null>(null);
  const [exportPct, setExportPct] = useState(0);

  const handleImageFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        addImageElement(reader.result, file.name);
      }
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handleExport = async (kind: 'pptx' | 'pdf') => {
    setExporting(kind);
    setExportPct(0);
    try {
      if (kind === 'pptx') {
        await exportDeckToPptx(deck, {
          includeInk: true,
          onProgress: setExportPct,
        });
      } else {
        await exportDeckToPdf(deck, {
          includeInk: true,
          onProgress: setExportPct,
        });
      }
    } finally {
      setExporting(null);
      setExportPct(0);
    }
  };

  const toolButtons: Array<{
    id: EditorTool;
    label: string;
    icon: React.ReactNode;
    onQuickAdd?: () => void;
  }> = [
    { id: 'select', label: '선택', icon: <MousePointer2 className="h-4 w-4" /> },
    {
      id: 'text',
      label: '텍스트',
      icon: <Type className="h-4 w-4" />,
      onQuickAdd: () => addTextElement(),
    },
    {
      id: 'roundedRect',
      label: '둥근 사각형',
      icon: <Square className="h-4 w-4" />,
      onQuickAdd: () => addShapeElement('roundedRect'),
    },
    {
      id: 'ellipse',
      label: '원형',
      icon: <Circle className="h-4 w-4" />,
      onQuickAdd: () => addShapeElement('ellipse'),
    },
    {
      id: 'triangle',
      label: '삼각형',
      icon: <Triangle className="h-4 w-4" />,
      onQuickAdd: () => addShapeElement('triangle'),
    },
    {
      id: 'arrowRight',
      label: '화살표',
      icon: <ArrowRight className="h-4 w-4" />,
      onQuickAdd: () => addShapeElement('arrowRight'),
    },
    {
      id: 'table',
      label: '표',
      icon: <Table className="h-4 w-4" />,
      onQuickAdd: () => addTableElement(3, 3),
    },
  ];

  return (
    <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-white px-3 py-2">
      {/* 좌측: 앱 로고 + 제목 + Undo/Redo */}
      <div className="flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-900 text-xs font-extrabold text-white">
          IC
        </div>
        <input
          type="text"
          lang="ko"
          inputMode="text"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          value={deck.title}
          onChange={(e) => setDeckTitle(e.target.value)}
          onKeyDown={(e) => {
            if (isImeComposing(e)) return;
            if (e.key === 'Enter') e.currentTarget.blur();
          }}
          className="w-40 rounded-lg border border-transparent px-2 py-1 text-sm font-bold text-slate-800 outline-none hover:border-slate-200 focus:border-blue-500 focus:bg-slate-50 sm:w-52"
        />

        <div className="flex items-center gap-0.5 border-l border-slate-200 pl-2">
          <button
            type="button"
            disabled={pastCount === 0}
            onClick={undo}
            title="실행 취소 (Ctrl+Z)"
            className="rounded-lg p-1.5 text-slate-600 hover:bg-slate-100 disabled:opacity-30"
          >
            <Undo2 className="h-4 w-4" />
          </button>
          <button
            type="button"
            disabled={futureCount === 0}
            onClick={redo}
            title="다시 실행 (Ctrl+Y)"
            className="rounded-lg p-1.5 text-slate-600 hover:bg-slate-100 disabled:opacity-30"
          >
            <Redo2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* 중앙: 요소 삽입 & S-Pen 필기 도구 */}
      <div className="flex flex-wrap items-center gap-1 rounded-xl bg-slate-100 p-1">
        {toolButtons.map((btn) => (
          <button
            key={btn.id}
            type="button"
            title={btn.label}
            onClick={() => {
              if (btn.onQuickAdd && activeTool === btn.id) {
                btn.onQuickAdd();
              } else {
                setActiveTool(btn.id);
                btn.onQuickAdd?.();
              }
            }}
            className={`inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium transition ${
              activeTool === btn.id
                ? 'bg-blue-600 text-white shadow-xs'
                : 'text-slate-700 hover:bg-white'
            }`}
          >
            {btn.icon}
            <span className="hidden xl:inline">{btn.label}</span>
          </button>
        ))}

        <button
          type="button"
          title="이미지 삽입"
          onClick={() => fileInputRef.current?.click()}
          className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium text-slate-700 hover:bg-white"
        >
          <ImageIcon className="h-4 w-4" />
          <span className="hidden xl:inline">이미지</span>
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleImageFile}
          className="hidden"
        />

        <div className="mx-1 h-5 w-px bg-slate-300" />

        <button
          type="button"
          title="S-Pen 스케치"
          onClick={() => setActiveTool('pen')}
          className={`inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium ${
            activeTool === 'pen'
              ? 'bg-rose-600 text-white shadow-xs'
              : 'text-slate-700 hover:bg-white'
          }`}
        >
          <Pen className="h-4 w-4" />
          <span className="hidden md:inline">펜</span>
        </button>
        <button
          type="button"
          title="형광펜"
          onClick={() => setActiveTool('highlighter')}
          className={`inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium ${
            activeTool === 'highlighter'
              ? 'bg-amber-500 text-white shadow-xs'
              : 'text-slate-700 hover:bg-white'
          }`}
        >
          <Highlighter className="h-4 w-4" />
        </button>
        <button
          type="button"
          title="펜 지우개"
          onClick={() => setActiveTool('eraser')}
          className={`inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium ${
            activeTool === 'eraser'
              ? 'bg-slate-800 text-white shadow-xs'
              : 'text-slate-700 hover:bg-white'
          }`}
        >
          <Eraser className="h-4 w-4" />
        </button>
        <input
          type="color"
          aria-label="펜 색상"
          value={penColor}
          onChange={(e) => setPenColor(e.target.value)}
          className="h-7 w-7 cursor-pointer rounded border border-slate-300 bg-white p-0.5"
        />
        <button
          type="button"
          title="현재 슬라이드 잉크 모두 지우기"
          onClick={clearSlideInk}
          className="rounded-lg p-1.5 text-slate-500 hover:bg-white hover:text-rose-600"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* 우측: Google Drive + 내보내기 + AI 패널 토글 */}
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => onOpenSettings('drive')}
          className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
        >
          <Cloud className="h-4 w-4 text-blue-600" />
          <span className="hidden sm:inline">Drive 저장</span>
        </button>

        <button
          type="button"
          disabled={exporting !== null}
          onClick={() => void handleExport('pptx')}
          className="inline-flex items-center gap-1 rounded-lg bg-blue-900 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-blue-800 disabled:bg-slate-400"
        >
          <Download className="h-3.5 w-3.5" />
          {exporting === 'pptx' ? `PPTX ${exportPct}%` : 'PPTX'}
        </button>

        <button
          type="button"
          disabled={exporting !== null}
          onClick={() => void handleExport('pdf')}
          className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          <FileText className="h-3.5 w-3.5" />
          {exporting === 'pdf' ? `PDF ${exportPct}%` : 'PDF'}
        </button>

        <button
          type="button"
          onClick={onToggleAiPanel}
          title="AI 패널 열기/닫기"
          className="rounded-lg border border-slate-200 p-1.5 text-slate-700 hover:bg-slate-100"
        >
          {showAiPanel ? (
            <PanelRightClose className="h-4 w-4" />
          ) : (
            <PanelRightOpen className="h-4 w-4" />
          )}
        </button>
      </div>
    </header>
  );
};
