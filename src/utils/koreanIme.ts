import type React from 'react';

export function isImeComposing(
  e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>,
): boolean {
  return e.nativeEvent.isComposing || e.keyCode === 229;
}

export function focusWithoutScroll(el: HTMLElement | null): void {
  if (!el) return;
  el.focus({ preventScroll: true });
}

export function delayedModalFocus(el: HTMLElement | null): () => void {
  const timer = window.setTimeout(() => {
    focusWithoutScroll(el);
  }, 60);
  return () => window.clearTimeout(timer);
}
