import React, { useEffect, useState } from 'react';
import { AiPromptPanel } from './components/AiPromptPanel';
import { SettingsModal } from './components/SettingsModal';
import { SlideCanvas } from './components/SlideCanvas';
import { SlideList } from './components/SlideList';
import { TopToolbar } from './components/TopToolbar';
import { useDeckStore } from './store/useDeckStore';

export const App: React.FC = () => {
  const hydrate = useDeckStore((s) => s.hydrate);
  const undo = useDeckStore((s) => s.undo);
  const redo = useDeckStore((s) => s.redo);

  const [showAiPanel, setShowAiPanel] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<'ai' | 'drive'>('ai');

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      ) {
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) {
          redo();
        } else {
          undo();
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [undo, redo]);

  const openSettings = (tab: 'ai' | 'drive' = 'ai') => {
    setSettingsTab(tab);
    setSettingsOpen(true);
  };

  return (
    <div className="flex h-dvh w-screen flex-col overflow-hidden bg-slate-100">
      <TopToolbar
        showAiPanel={showAiPanel}
        onToggleAiPanel={() => setShowAiPanel((prev) => !prev)}
        onOpenSettings={openSettings}
      />

      <main className="flex min-h-0 flex-1 overflow-hidden">
        <SlideList />
        <SlideCanvas />
        {showAiPanel && <AiPromptPanel onOpenSettings={openSettings} />}
      </main>

      <SettingsModal
        isOpen={settingsOpen}
        initialTab={settingsTab}
        onClose={() => setSettingsOpen(false)}
      />
    </div>
  );
};

export default App;
