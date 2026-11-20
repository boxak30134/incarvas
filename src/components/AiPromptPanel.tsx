import React, { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  BrainCircuit,
  CheckCircle2,
  Palette,
  PenTool,
  RefreshCw,
  Send,
  Settings,
  Sparkles,
  Square,
  Trash2,
  Undo2,
} from 'lucide-react';
import {
  AI_MODEL_OPTIONS,
  resolveApiKey,
  runSlideAiRequest,
} from '../services/aiService';
import { useDeckStore } from '../store/useDeckStore';
import type { AiProvider, AiRequestMode } from '../types/slide';
import { isImeComposing } from '../utils/koreanIme';
import {
  buildDeckOutline,
  diagnoseSlideLocal,
} from '../utils/slideDiagnostics';
import { renderSlideToDataUrl } from '../utils/strokeRenderer';

let activeAbortController: AbortController | null = null;

interface AiPromptPanelProps {
  onOpenSettings: (tab?: 'ai' | 'drive') => void;
}

const DESIGN_PRESETS = [
  '연세 블루 학술 발표 느낌의 깔끔한 카드형 레이아웃으로 디자인해줘',
  '초안 도형과 S-Pen 스케치를 반영해 3단 비교 인포그래픽으로 정리해줘',
  '여백을 넓히고 제목·핵심 키워드 위주로 시인성을 높여줘',
];

const FEEDBACK_PRESETS = [
  '이 슬라이드의 핵심 내용을 3줄로 요약하고 논리적 흐름을 피드백해줘',
  '교육대학원 발표 기준으로 학습 목표 전달력과 개선점을 제안해줘',
  '청중이 한눈에 이해할 수 있도록 문구를 더 간결하게 다듬어줘',
];

export const AiPromptPanel: React.FC<AiPromptPanelProps> = ({
  onOpenSettings,
}) => {
  const deck = useDeckStore((s) => s.deck);
  const activeSlideId = useDeckStore((s) => s.activeSlideId);
  const aiProvider = useDeckStore((s) => s.aiProvider);
  const aiModelId = useDeckStore((s) => s.aiModelId);
  const aiMessages = useDeckStore((s) => s.aiMessages);
  const aiStatus = useDeckStore((s) => s.aiStatus);
  const aiStatusDetail = useDeckStore((s) => s.aiStatusDetail);

  const setAiModel = useDeckStore((s) => s.setAiModel);
  const setAiStatus = useDeckStore((s) => s.setAiStatus);
  const appendAiMessage = useDeckStore((s) => s.appendAiMessage);
  const updateAiMessageContent = useDeckStore((s) => s.updateAiMessageContent);
  const clearAiMessages = useDeckStore((s) => s.clearAiMessages);
  const applyAiDesignPatch = useDeckStore((s) => s.applyAiDesignPatch);
  const undo = useDeckStore((s) => s.undo);
  const pastCount = useDeckStore((s) => s.past.length);

  const [mode, setMode] = useState<AiRequestMode>('design');
  const [prompt, setPrompt] = useState('');
  const [customModel, setCustomModel] = useState('');
  const [showCustomModel, setShowCustomModel] = useState(false);
  const [hasKey, setHasKey] = useState<boolean | null>(null);
  const [lastPrompt, setLastPrompt] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const listEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let mounted = true;
    resolveApiKey(aiProvider).then((key) => {
      if (mounted) setHasKey(Boolean(key));
    });
    return () => {
      mounted = false;
    };
  }, [aiProvider, aiStatus]);

  useEffect(() => {
    listEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [aiMessages.length]);

  const activeSlide =
    deck.slides.find((s) => s.id === activeSlideId) ?? deck.slides[0];

  const isRunning =
    aiStatus === 'connecting' ||
    aiStatus === 'retrying' ||
    aiStatus === 'fallback' ||
    aiStatus === 'streaming';

  const handleSubmit = async (overridePrompt?: string) => {
    const text = (overridePrompt ?? prompt).trim();
    if (!text || isRunning) return;

    setErrorMsg('');
    setLastPrompt(text);
    if (!overridePrompt) setPrompt('');

    appendAiMessage({
      role: 'user',
      mode,
      content: text,
    });

    const assistantMsgId = appendAiMessage({
      role: 'assistant',
      mode,
      content: '응답을 준비하고 있습니다...',
    });

    const controller = new AbortController();
    activeAbortController = controller;

    try {
      const needsVisualSnapshot =
        activeSlide.strokes.length > 0 ||
        activeSlide.elements.some((el) => el.type === 'image');

      const snapshot = needsVisualSnapshot
        ? await renderSlideToDataUrl(activeSlide, {
            scale: 0.5,
            mimeType: 'image/jpeg',
            quality: 0.65,
            includeInk: true,
          })
        : '';

      const priorMessages = useDeckStore
        .getState()
        .aiMessages.slice(0, -2)
        .filter((m) => !m.content.startsWith('⚠️'));

      const result = await runSlideAiRequest({
        provider: aiProvider,
        modelId: aiModelId,
        mode,
        prompt: text,
        slide: activeSlide,
        deckOutline: mode === 'feedback' ? buildDeckOutline(deck.slides) : undefined,
        slideSnapshotDataUrl: snapshot || undefined,
        history: priorMessages,
        signal: controller.signal,
        onStatus: (status, detail) => setAiStatus(status, detail),
        onChunk: (partial) => {
          updateAiMessageContent(assistantMsgId, partial);
        },
      });

      let appliedDesign = false;
      let displayBody = result.text;

      if (mode === 'design') {
        if (result.designPatch) {
          applyAiDesignPatch(result.designPatch);
          appliedDesign = true;
          displayBody = `${result.designPatch.explanation}\n\n✅ 현재 슬라이드에 AI 디자인이 적용되었습니다. (마음에 들지 않으면 상단 [실행 취소]로 되돌릴 수 있습니다.)`;
        } else {
          setAiStatus('error', '디자인 JSON 파싱 실패');
          displayBody =
            '⚠️ AI 응답이 중간에 끊겼거나 슬라이드 디자인 형식(JSON)으로 완성되지 않아 적용하지 못했습니다. 상단 [다시 시도]를 눌러 다시 요청해 주세요.';
        }
      }

      if (result.modelUsed && result.modelUsed !== aiModelId) {
        setAiModel(aiProvider, result.modelUsed);
      }

      updateAiMessageContent(assistantMsgId, displayBody, {
        appliedDesign,
        modelUsed: result.modelUsed,
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        setAiStatus('cancelled');
        updateAiMessageContent(assistantMsgId, '사용자에 의해 요청이 취소되었습니다.');
        return;
      }
      const msg = err instanceof Error ? err.message : '알 수 없는 오류가 발생했습니다.';
      setAiStatus('error', msg);
      setErrorMsg(msg);
      updateAiMessageContent(assistantMsgId, `⚠️ ${msg}`);
    } finally {
      if (activeAbortController === controller) {
        activeAbortController = null;
      }
    }
  };

  const handleCancel = () => {
    activeAbortController?.abort();
  };

  const statusLabel = (() => {
    switch (aiStatus) {
      case 'connecting':
        return `연결 중 (${aiStatusDetail || aiModelId})`;
      case 'retrying':
        return `재시도 중 (${aiStatusDetail})`;
      case 'fallback':
        return `폴백 모델 전환 (${aiStatusDetail})`;
      case 'streaming':
        return `생성 중 (${aiStatusDetail || aiModelId})`;
      case 'done':
        return `완료 · ${aiStatusDetail || aiModelId}`;
      case 'error':
        return '오류 발생';
      case 'cancelled':
        return '요청 취소됨';
      default:
        return '대기 중';
    }
  })();

  const estimatedInputTokens = Math.min(1800, 450 + activeSlide.elements.length * 45 + prompt.length);
  const maxOutTokens = mode === 'design' ? 4096 : 1500;
  const localDiag = diagnoseSlideLocal(activeSlide);

  return (
    <aside
      aria-label="AI 디자인 및 피드백 패널"
      className="flex h-full w-80 shrink-0 flex-col border-l border-slate-200 bg-white lg:w-96"
    >
      {/* 헤더 & 모드 전환 */}
      <div className="border-b border-slate-200 p-3">
        <div className="mb-2.5 flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <Sparkles className="h-4 w-4 text-blue-600" />
            <h2 className="text-sm font-bold text-slate-800">AI 슬라이드 어시스턴트</h2>
          </div>
          <div className="flex items-center gap-1">
            {aiMessages.length > 0 && (
              <button
                type="button"
                onClick={clearAiMessages}
                title="대화 비우기"
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
            <button
              type="button"
              onClick={() => onOpenSettings('ai')}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-50"
            >
              <Settings className="h-3.5 w-3.5" />
              키 설정
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1">
          <button
            type="button"
            onClick={() => setMode('design')}
            className={`flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-semibold transition ${
              mode === 'design'
                ? 'bg-white text-blue-700 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Palette className="h-3.5 w-3.5" />
            디자인 입히기
          </button>
          <button
            type="button"
            onClick={() => setMode('feedback')}
            className={`flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-semibold transition ${
              mode === 'feedback'
                ? 'bg-white text-indigo-700 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <BrainCircuit className="h-3.5 w-3.5" />
            내용 요약·피드백
          </button>
        </div>

        {/* 모델 선택기 */}
        <div className="mt-2.5">
          <select
            aria-label="AI 모델 선택"
            value={showCustomModel ? '__custom__' : `${aiProvider}::${aiModelId}`}
            onChange={(e) => {
              const val = e.target.value;
              if (val === '__custom__') {
                setShowCustomModel(true);
                return;
              }
              setShowCustomModel(false);
              const [prov, id] = val.split('::') as [AiProvider, string];
              setAiModel(prov, id);
            }}
            className="w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-medium text-slate-700 outline-none focus:border-blue-500"
          >
            {(['google', 'openai', 'anthropic'] as const).map((group) => (
              <optgroup
                key={group}
                label={
                  group === 'google'
                    ? 'Google Gemini (무료 AI Studio 키 지원)'
                    : group === 'openai'
                      ? 'OpenAI'
                      : 'Anthropic Claude'
                }
              >
                {AI_MODEL_OPTIONS.filter((m) => m.provider === group).map((m) => (
                  <option key={m.id} value={`${m.provider}::${m.id}`}>
                    {m.label} · {m.tokenBadge}
                  </option>
                ))}
              </optgroup>
            ))}
            <option value="__custom__">기타 모델 ID 직접 입력...</option>
          </select>

          {showCustomModel && (
            <div className="mt-1.5 flex gap-1">
              <input
                type="text"
                lang="ko"
                value={customModel}
                onChange={(e) => setCustomModel(e.target.value)}
                placeholder="예: gemini-3.8-flash"
                className="flex-1 rounded-lg border border-slate-300 px-2 py-1 text-xs outline-none focus:border-blue-500"
              />
              <button
                type="button"
                onClick={() => {
                  if (customModel.trim()) {
                    setAiModel(aiProvider, customModel.trim());
                    setShowCustomModel(false);
                  }
                }}
                className="rounded-lg bg-slate-800 px-2.5 py-1 text-xs font-semibold text-white"
              >
                적용
              </button>
            </div>
          )}
        </div>
      </div>

      {/* BYOK 키 미입력 폴백 배너 */}
      {hasKey === false && (
        <div className="mx-3 mt-2.5 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <div className="flex-1">
            <p className="font-semibold">BYOK API 키가 아직 입력되지 않았습니다.</p>
            <p className="mt-0.5 text-[11px] text-amber-800">
              Google AI Studio에서 카드 없이 무료 키를 발급받아 등록하면 바로 사용할 수 있습니다.
            </p>
            <button
              type="button"
              onClick={() => onOpenSettings('ai')}
              className="mt-1.5 rounded-lg bg-amber-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-amber-700"
            >
              API 키 입력하기
            </button>
          </div>
        </div>
      )}

      {/* Zero-Token 로컬 가독성 진단 & S-Pen 스케치 상태 */}
      <div className="mx-3 mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
        <span
          title={
            localDiag.warnings.length > 0
              ? localDiag.warnings.join('\n')
              : '글자 크기·밀도·대비가 양호합니다.'
          }
          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium ${
            localDiag.warnings.length === 0
              ? 'bg-emerald-50 text-emerald-700'
              : 'bg-amber-50 text-amber-800'
          }`}
        >
          0-Token 진단 {localDiag.score}점
          {localDiag.warnings.length > 0 && ` (${localDiag.warnings.length}건)`}
        </span>
        {localDiag.hasSketch && (
          <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2 py-0.5 font-medium text-rose-700">
            <PenTool className="h-3 w-3" />
            S-Pen 스케치 포함
          </span>
        )}
      </div>

      {/* 7단계 상태 배너 */}
      {aiStatus !== 'idle' && (
        <div className="mx-3 mt-2 flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-[11px]">
          <span className="flex items-center gap-1.5 font-medium text-slate-700">
            {aiStatus === 'done' && (
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
            )}
            {statusLabel}
          </span>
          <div className="flex items-center gap-1">
            {isRunning && (
              <button
                type="button"
                onClick={handleCancel}
                className="inline-flex items-center gap-1 rounded bg-rose-100 px-2 py-0.5 font-semibold text-rose-700"
              >
                <Square className="h-2.5 w-2.5 fill-current" />
                취소
              </button>
            )}
            {(aiStatus === 'error' || aiStatus === 'cancelled') && lastPrompt && (
              <button
                type="button"
                onClick={() => handleSubmit(lastPrompt)}
                className="inline-flex items-center gap-1 rounded bg-blue-100 px-2 py-0.5 font-semibold text-blue-700"
              >
                <RefreshCw className="h-2.5 w-2.5" />
                다시 시도
              </button>
            )}
          </div>
        </div>
      )}

      {/* 대화 로그 */}
      <div className="flex-1 space-y-2.5 overflow-y-auto p-3">
        {aiMessages.length === 0 ? (
          <div className="space-y-2 rounded-xl border border-dashed border-slate-200 bg-slate-50/70 p-3">
            <p className="text-xs font-semibold text-slate-700">
              {mode === 'design'
                ? '💡 초안 배치 후 디자인 요청 예시'
                : '💡 내용·논리 피드백 요청 예시'}
            </p>
            <div className="space-y-1.5">
              {(mode === 'design' ? DESIGN_PRESETS : FEEDBACK_PRESETS).map(
                (preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => setPrompt(preset)}
                    className="block w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-left text-[11px] text-slate-600 hover:border-blue-400 hover:text-blue-700"
                  >
                    “{preset}”
                  </button>
                ),
              )}
            </div>
          </div>
        ) : (
          aiMessages.map((msg) => (
            <div
              key={msg.id}
              className={`rounded-xl px-3 py-2 text-xs leading-relaxed ${
                msg.role === 'user'
                  ? 'ml-6 bg-blue-600 text-white'
                  : 'mr-2 border border-slate-200 bg-slate-50 text-slate-800'
              }`}
            >
              <div className="mb-1 flex items-center justify-between text-[10px] opacity-75">
                <span>
                  {msg.role === 'user'
                    ? msg.mode === 'design'
                      ? '디자인 요청'
                      : '피드백 요청'
                    : msg.modelUsed
                      ? `AI · ${msg.modelUsed}`
                      : 'AI 어시스턴트'}
                </span>
              </div>
              <div className="whitespace-pre-wrap break-words">{msg.content}</div>
              {msg.role === 'assistant' && msg.appliedDesign && pastCount > 0 && (
                <button
                  type="button"
                  onClick={undo}
                  className="mt-2 inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-100"
                >
                  <Undo2 className="h-3 w-3" />
                  적용 되돌리기
                </button>
              )}
            </div>
          ))
        )}
        <div ref={listEndRef} />
      </div>

      {/* 입력 창 */}
      <div className="border-t border-slate-200 p-3">
        {errorMsg && (
          <p className="mb-1.5 text-[11px] text-rose-600">{errorMsg}</p>
        )}
        <div className="flex flex-col gap-2 rounded-xl border border-slate-300 bg-white p-2 focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-500/20">
          <textarea
            lang="ko"
            inputMode="text"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            rows={3}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (isImeComposing(e)) return;
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void handleSubmit();
              }
            }}
            placeholder={
              mode === 'design'
                ? '원하는 디자인 분위기·색감·배치를 입력하세요 (S-Pen 스케치도 함께 인식됩니다)'
                : '요약, 논리 점검, 교육학적 피드백 등 요청사항을 입력하세요'
            }
            className="w-full resize-none bg-transparent text-xs text-slate-800 outline-none placeholder:text-slate-400"
          />
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-slate-400">
              예상 입력 ~{estimatedInputTokens} tok · 상한 {maxOutTokens}
            </span>
            <button
              type="button"
              disabled={!prompt.trim() || isRunning}
              onClick={() => void handleSubmit()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              <Send className="h-3.5 w-3.5" />
              {mode === 'design' ? '디자인 적용' : '피드백 받기'}
            </button>
          </div>
        </div>
      </div>
    </aside>
  );
};
