import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Cloud,
  CloudDownload,
  CloudUpload,
  ExternalLink,
  KeyRound,
  LogOut,
  ShieldCheck,
  X,
} from 'lucide-react';
import {
  deleteSecret,
  isValidKeyFormat,
  loadSecret,
  maskApiKey,
  normalizeApiKey,
  providerToSecretSlot,
  saveSecret,
} from '../services/cryptoStorage';
import {
  connectGoogleDrive,
  disconnectDriveAccount,
  getStoredDriveClientId,
  getStoredDriveToken,
  listDriveDecks,
  loadDeckFromGoogleDrive,
  resetDriveFolderBinding,
  saveDeckToGoogleDrive,
  SyncFolderMissingError,
  type DriveFileSummary,
} from '../services/driveService';
import { useDeckStore } from '../store/useDeckStore';
import type { AiProvider } from '../types/slide';
import { delayedModalFocus } from '../utils/koreanIme';

interface SettingsModalProps {
  isOpen: boolean;
  initialTab?: 'ai' | 'drive';
  onClose: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  initialTab = 'ai',
  onClose,
}) => {
  const deck = useDeckStore((s) => s.deck);
  const replaceDeck = useDeckStore((s) => s.replaceDeck);

  const [tab, setTab] = useState<'ai' | 'drive'>(initialTab);
  const [keys, setKeys] = useState<Record<AiProvider, string>>({
    google: '',
    openai: '',
    anthropic: '',
  });
  const [savedMasks, setSavedMasks] = useState<Record<AiProvider, string>>({
    google: '',
    openai: '',
    anthropic: '',
  });
  const [aiNotice, setAiNotice] = useState('');

  const [clientId, setClientId] = useState('');
  const [driveToken, setDriveToken] = useState('');
  const [driveFiles, setDriveFiles] = useState<DriveFileSummary[]>([]);
  const [driveStatus, setDriveStatus] = useState('');
  const [driveBusy, setDriveBusy] = useState(false);

  const firstInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setTab(initialTab);
  }, [initialTab]);

  useEffect(() => {
    if (!isOpen) return;
    const cancelFocus = delayedModalFocus(firstInputRef.current);

    void (async () => {
      const [g, o, a, cid, tok] = await Promise.all([
        loadSecret('ai:google'),
        loadSecret('ai:openai'),
        loadSecret('ai:anthropic'),
        getStoredDriveClientId(),
        getStoredDriveToken(),
      ]);
      setSavedMasks({
        google: maskApiKey(g),
        openai: maskApiKey(o),
        anthropic: maskApiKey(a),
      });
      setClientId(cid);
      setDriveToken(tok);
      if (tok) {
        try {
          const files = await listDriveDecks(tok);
          setDriveFiles(files);
        } catch {
          // Token may have expired; user can reconnect
        }
      }
    })();

    return cancelFocus;
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSaveKey = async (provider: AiProvider) => {
    const cleaned = normalizeApiKey(keys[provider]);
    if (!cleaned) return;
    if (!isValidKeyFormat(provider, cleaned)) {
      setAiNotice(
        `⚠️ ${provider.toUpperCase()} 키 형식이 올바르지 않습니다. 공백·한글·잘림 없이 API 키 전체 문자열만 입력했는지 확인해 주세요.`,
      );
      return;
    }
    await saveSecret(providerToSecretSlot(provider), cleaned);
    setSavedMasks((prev) => ({ ...prev, [provider]: maskApiKey(cleaned) }));
    setKeys((prev) => ({ ...prev, [provider]: '' }));
    setAiNotice(
      `${provider.toUpperCase()} API 키가 AES-GCM 암호화되어 저장되었습니다 (${maskApiKey(cleaned)}).`,
    );
  };

  const handleDeleteKey = async (provider: AiProvider) => {
    await deleteSecret(providerToSecretSlot(provider));
    setSavedMasks((prev) => ({ ...prev, [provider]: '' }));
    setAiNotice(`${provider.toUpperCase()} API 키가 삭제되었습니다.`);
  };

  const handleDriveConnect = async () => {
    setDriveBusy(true);
    setDriveStatus('');
    try {
      const token = await connectGoogleDrive(clientId);
      setDriveToken(token);
      const files = await listDriveDecks(token);
      setDriveFiles(files);
      setDriveStatus('Google Drive(앱 전용 폴더 최소 권한)에 연결되었습니다.');
    } catch (err) {
      setDriveStatus(err instanceof Error ? err.message : '연결에 실패했습니다.');
    } finally {
      setDriveBusy(false);
    }
  };

  const handleDriveSaveDeck = async () => {
    if (!driveToken) return;
    setDriveBusy(true);
    setDriveStatus('');
    try {
      const res = await saveDeckToGoogleDrive(driveToken, deck);
      const files = await listDriveDecks(driveToken);
      setDriveFiles(files);
      setDriveStatus(`Google Drive에 저장 완료: ${res.fileName}`);
    } catch (err) {
      if (err instanceof SyncFolderMissingError) {
        setDriveStatus(
          '지정된 Google Drive 폴더가 삭제되어 동기화가 일시 중지되었습니다. 아래 [폴더 연결 재설정]을 눌러 새 폴더를 지정하세요.',
        );
      } else {
        setDriveStatus(err instanceof Error ? err.message : '저장에 실패했습니다.');
      }
    } finally {
      setDriveBusy(false);
    }
  };

  const handleDriveLoadDeck = async (fileId: string) => {
    if (!driveToken) return;
    setDriveBusy(true);
    setDriveStatus('');
    try {
      const loaded = await loadDeckFromGoogleDrive(driveToken, fileId);
      replaceDeck(loaded);
      setDriveStatus(`불러오기 완료: ${loaded.title}`);
      onClose();
    } catch (err) {
      setDriveStatus(err instanceof Error ? err.message : '불러오기에 실패했습니다.');
    } finally {
      setDriveBusy(false);
    }
  };

  const handleDriveDisconnect = async () => {
    await disconnectDriveAccount();
    setDriveToken('');
    setDriveFiles([]);
    setDriveStatus('Google 계정 연동이 해제되었습니다. 로컬 작업물은 그대로 보존됩니다.');
  };

  return createPortal(
    <div
      data-overlay="settings-modal"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-xs"
    >
      <div className="flex max-h-[90vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3.5">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-blue-600" />
            <h2 className="text-base font-bold text-slate-900">
              BYOK API 키 및 Google Drive 설정
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex border-b border-slate-200 bg-slate-50 px-5 pt-2">
          <button
            type="button"
            onClick={() => setTab('ai')}
            className={`mr-4 border-b-2 pb-2 text-xs font-semibold ${
              tab === 'ai'
                ? 'border-blue-600 text-blue-700'
                : 'border-transparent text-slate-500'
            }`}
          >
            <span className="inline-flex items-center gap-1.5">
              <KeyRound className="h-3.5 w-3.5" />
              AI API 키 (BYOK)
            </span>
          </button>
          <button
            type="button"
            onClick={() => setTab('drive')}
            className={`border-b-2 pb-2 text-xs font-semibold ${
              tab === 'drive'
                ? 'border-blue-600 text-blue-700'
                : 'border-transparent text-slate-500'
            }`}
          >
            <span className="inline-flex items-center gap-1.5">
              <Cloud className="h-3.5 w-3.5" />
              Google Drive 저장·불러오기
            </span>
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-5 text-xs">
          {tab === 'ai' ? (
            <>
              <div className="rounded-xl border border-blue-100 bg-blue-50/70 p-3 text-blue-900">
                <p className="font-semibold">카드 없는 무료 BYOK 안내</p>
                <p className="mt-1 text-[11px] leading-relaxed">
                  입력한 키는 서버로 전송되지 않고 내 기기(IndexedDB + AES-GCM 암호화)에만 안전하게 격리 저장됩니다.
                </p>
                <a
                  href="https://aistudio.google.com/apikey"
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1.5 inline-flex items-center gap-1 font-semibold text-blue-700 underline"
                >
                  Google AI Studio 무료 키 발급받기
                  <ExternalLink className="h-3 w-3" />
                </a>
              </div>

              {(
                [
                  {
                    provider: 'google' as const,
                    title: 'Google Gemini API Key',
                    placeholder: 'AIzaSy...',
                  },
                  {
                    provider: 'openai' as const,
                    title: 'OpenAI API Key (선택)',
                    placeholder: 'sk-...',
                  },
                  {
                    provider: 'anthropic' as const,
                    title: 'Anthropic Claude API Key (선택)',
                    placeholder: 'sk-ant-...',
                  },
                ] as const
              ).map((item, idx) => (
                <div
                  key={item.provider}
                  className="rounded-xl border border-slate-200 p-3"
                >
                  <div className="mb-1.5 flex items-center justify-between">
                    <span className="font-semibold text-slate-800">
                      {item.title}
                    </span>
                    {savedMasks[item.provider] ? (
                      <span className="rounded bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
                        저장됨: {savedMasks[item.provider]}
                      </span>
                    ) : (
                      <span className="text-[11px] text-slate-400">미등록</span>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <input
                      ref={idx === 0 ? firstInputRef : undefined}
                      type="password"
                      lang="ko"
                      autoCapitalize="off"
                      autoCorrect="off"
                      spellCheck={false}
                      value={keys[item.provider]}
                      onChange={(e) =>
                        setKeys((prev) => ({
                          ...prev,
                          [item.provider]: e.target.value,
                        }))
                      }
                      placeholder={item.placeholder}
                      className="flex-1 rounded-lg border border-slate-300 px-3 py-1.5 text-xs outline-none focus:border-blue-500"
                    />
                    <button
                      type="button"
                      onClick={() => void handleSaveKey(item.provider)}
                      className="rounded-lg bg-blue-600 px-3 py-1.5 font-semibold text-white hover:bg-blue-700"
                    >
                      저장
                    </button>
                    {savedMasks[item.provider] && (
                      <button
                        type="button"
                        onClick={() => void handleDeleteKey(item.provider)}
                        className="rounded-lg border border-rose-200 px-2.5 py-1.5 font-semibold text-rose-600 hover:bg-rose-50"
                      >
                        삭제
                      </button>
                    )}
                  </div>
                </div>
              ))}

              {aiNotice && (
                <p className="rounded-lg bg-emerald-50 px-3 py-2 font-medium text-emerald-800">
                  {aiNotice}
                </p>
              )}
            </>
          ) : (
            <>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-slate-700">
                <p className="font-semibold text-slate-900">
                  최소 권한(drive.file) 보안 연동
                </p>
                <p className="mt-1 text-[11px] leading-relaxed">
                  사용자의 전체 드라이브가 아닌 앱이 생성한 전용 폴더(<code>InCarvas_Presentations</code>) 내부 파일에만 접근합니다. 연동을 해제해도 로컬 저장 작업물은 유지됩니다.
                </p>
              </div>

              <div>
                <label className="mb-1 block font-semibold text-slate-700">
                  Google OAuth 2.0 Web Client ID
                </label>
                <div className="flex gap-2">
                  <input
                    ref={firstInputRef}
                    type="text"
                    value={clientId}
                    onChange={(e) => setClientId(e.target.value)}
                    placeholder="1234567890-xxxx.apps.googleusercontent.com"
                    className="flex-1 rounded-lg border border-slate-300 px-3 py-1.5 text-xs outline-none focus:border-blue-500"
                  />
                  <button
                    type="button"
                    disabled={driveBusy}
                    onClick={() => void handleDriveConnect()}
                    className="rounded-lg bg-blue-600 px-3 py-1.5 font-semibold text-white hover:bg-blue-700 disabled:bg-slate-300"
                  >
                    {driveToken ? '재인증' : 'Google 연결'}
                  </button>
                </div>
              </div>

              {driveToken && (
                <div className="space-y-3 rounded-xl border border-slate-200 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <button
                      type="button"
                      disabled={driveBusy}
                      onClick={() => void handleDriveSaveDeck()}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 font-semibold text-white hover:bg-emerald-700 disabled:bg-slate-300"
                    >
                      <CloudUpload className="h-4 w-4" />
                      현재 프레젠테이션 Drive에 저장
                    </button>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          void resetDriveFolderBinding().then(() =>
                            setDriveStatus('폴더 연결이 초기화되었습니다. 다시 저장을 누르면 새 폴더를 연결합니다.'),
                          )
                        }
                        className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-[11px] font-medium text-slate-700 hover:bg-slate-50"
                      >
                        폴더 연결 재설정
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleDriveDisconnect()}
                        className="inline-flex items-center gap-1 rounded-lg border border-rose-200 px-2.5 py-1.5 text-[11px] font-semibold text-rose-600 hover:bg-rose-50"
                      >
                        <LogOut className="h-3.5 w-3.5" />
                        연동 해제
                      </button>
                    </div>
                  </div>

                  <div>
                    <p className="mb-1.5 font-semibold text-slate-700">
                      Drive 저장 파일 목록 ({driveFiles.length})
                    </p>
                    {driveFiles.length === 0 ? (
                      <p className="text-[11px] text-slate-400">
                        저장된 프레젠테이션이 없습니다.
                      </p>
                    ) : (
                      <div className="max-h-40 space-y-1.5 overflow-y-auto">
                        {driveFiles.map((f) => (
                          <div
                            key={f.id}
                            className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5"
                          >
                            <div className="min-w-0">
                              <p className="truncate font-medium text-slate-800">
                                {f.name}
                              </p>
                              <p className="text-[10px] text-slate-400">
                                {new Date(f.modifiedTime).toLocaleString('ko-KR')}
                              </p>
                            </div>
                            <button
                              type="button"
                              disabled={driveBusy}
                              onClick={() => void handleDriveLoadDeck(f.id)}
                              className="inline-flex shrink-0 items-center gap-1 rounded bg-white px-2.5 py-1 text-[11px] font-semibold text-blue-700 ring-1 ring-slate-200 hover:bg-blue-50"
                            >
                              <CloudDownload className="h-3.5 w-3.5" />
                              불러오기
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {driveStatus && (
                <p className="rounded-lg bg-blue-50 px-3 py-2 font-medium text-blue-800">
                  {driveStatus}
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
};
