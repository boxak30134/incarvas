import type { AiProvider, DeckDocument } from '../types/slide';

const DB_NAME = 'incarvas_db_v1';
const DB_VERSION = 1;
const STORE_SECRETS = 'encrypted_secrets';
const STORE_DECKS = 'decks';
const DEVICE_KEY_STORAGE = 'incarvas_device_aes_key_jwk';

export type SecretSlot =
  | 'ai:google'
  | 'ai:openai'
  | 'ai:anthropic'
  | 'oauth:google-drive-token'
  | 'oauth:google-drive-client-id'
  | 'oauth:google-drive-folder-id';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_SECRETS)) {
        db.createObjectStore(STORE_SECRETS);
      }
      if (!db.objectStoreNames.contains(STORE_DECKS)) {
        db.createObjectStore(STORE_DECKS, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
  });
}

async function getOrCreateAesKey(): Promise<CryptoKey | null> {
  if (typeof crypto === 'undefined' || !crypto.subtle) {
    return null;
  }
  try {
    const existing = localStorage.getItem(DEVICE_KEY_STORAGE);
    if (existing) {
      const jwk = JSON.parse(existing) as JsonWebKey;
      return await crypto.subtle.importKey(
        'jwk',
        jwk,
        { name: 'AES-GCM', length: 256 },
        true,
        ['encrypt', 'decrypt'],
      );
    }
    const key = await crypto.subtle.generateKey(
      { name: 'AES-GCM', length: 256 },
      true,
      ['encrypt', 'decrypt'],
    );
    const exported = await crypto.subtle.exportKey('jwk', key);
    localStorage.setItem(DEVICE_KEY_STORAGE, JSON.stringify(exported));
    return key;
  } catch {
    return null;
  }
}

interface EncryptedPayload {
  encrypted: boolean;
  iv?: number[];
  data: number[] | string;
}

export async function saveSecret(slot: SecretSlot, value: string): Promise<void> {
  const trimmed = value.trim();
  if (!trimmed) {
    await deleteSecret(slot);
    return;
  }

  const aesKey = await getOrCreateAesKey();
  let payload: EncryptedPayload;
  if (aesKey) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encoded = new TextEncoder().encode(trimmed);
    const cipherBuffer = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      aesKey,
      encoded,
    );
    payload = {
      encrypted: true,
      iv: Array.from(iv),
      data: Array.from(new Uint8Array(cipherBuffer)),
    };
  } else {
    payload = { encrypted: false, data: trimmed };
  }

  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_SECRETS, 'readwrite');
      tx.objectStore(STORE_SECRETS).put(payload, slot);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    localStorage.setItem(`incarvas_fallback_${slot}`, JSON.stringify(payload));
  }
}

export async function loadSecret(slot: SecretSlot): Promise<string> {
  let payload: EncryptedPayload | undefined;
  try {
    const db = await openDb();
    payload = await new Promise<EncryptedPayload | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE_SECRETS, 'readonly');
      const req = tx.objectStore(STORE_SECRETS).get(slot);
      req.onsuccess = () => resolve(req.result as EncryptedPayload | undefined);
      req.onerror = () => reject(req.error);
    });
    db.close();
  } catch {
    const raw = localStorage.getItem(`incarvas_fallback_${slot}`);
    if (raw) {
      payload = JSON.parse(raw) as EncryptedPayload;
    }
  }

  if (!payload) return '';
  if (!payload.encrypted) {
    return typeof payload.data === 'string' ? payload.data : '';
  }

  const aesKey = await getOrCreateAesKey();
  if (!aesKey || !payload.iv || !Array.isArray(payload.data)) {
    return '';
  }
  try {
    const iv = new Uint8Array(payload.iv);
    const cipherBytes = new Uint8Array(payload.data);
    const plainBuffer = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      aesKey,
      cipherBytes,
    );
    return new TextDecoder().decode(plainBuffer);
  } catch {
    return '';
  }
}

export async function deleteSecret(slot: SecretSlot): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_SECRETS, 'readwrite');
      tx.objectStore(STORE_SECRETS).delete(slot);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    // Fallback cleanup handled below
  }
  localStorage.removeItem(`incarvas_fallback_${slot}`);
}

export function providerToSecretSlot(provider: AiProvider): SecretSlot {
  switch (provider) {
    case 'google':
      return 'ai:google';
    case 'openai':
      return 'ai:openai';
    case 'anthropic':
      return 'ai:anthropic';
  }
}

export function maskApiKey(key: string): string {
  const trimmed = key.trim();
  if (!trimmed) return '';
  if (trimmed.length <= 10) return '****';
  return `${trimmed.slice(0, 5)}***${trimmed.slice(-4)}`;
}

export function normalizeApiKey(raw: string): string {
  let cleaned = raw.replace(/[\u200B-\u200D\uFEFF]/g, '').trim();
  cleaned = cleaned.replace(
    /^(?:GEMINI_API_KEY|GOOGLE_API_KEY|VITE_GEMINI_API_KEY|OPENAI_API_KEY|ANTHROPIC_API_KEY)\s*=\s*/i,
    '',
  );
  cleaned = cleaned.replace(/^Bearer\s+/i, '').trim();
  if (
    (cleaned.startsWith('"') && cleaned.endsWith('"')) ||
    (cleaned.startsWith("'") && cleaned.endsWith("'")) ||
    (cleaned.startsWith('`') && cleaned.endsWith('`'))
  ) {
    cleaned = cleaned.slice(1, -1).trim();
  }
  return cleaned;
}

export function sanitizeLogMessage(message: string, knownSecrets: string[] = []): string {
  let safe = message
    .replace(/AIza[0-9A-Za-z._-]{20,}/g, (m) => maskApiKey(m))
    .replace(/AQ\.[0-9A-Za-z._-]{16,}/g, (m) => maskApiKey(m))
    .replace(/sk-[0-9A-Za-z._-]{20,}/g, (m) => maskApiKey(m))
    .replace(/Bearer\s+[0-9A-Za-z._-]{16,}/gi, 'Bearer ***');

  for (const secret of knownSecrets) {
    if (secret && secret.length > 8) {
      safe = safe.split(secret).join(maskApiKey(secret));
    }
  }
  return safe;
}

export function isValidKeyFormat(provider: AiProvider, key: string): boolean {
  const normalized = normalizeApiKey(key);
  if (normalized.length < 16) return false;
  if (!/^[!-~]+$/.test(normalized)) return false;
  switch (provider) {
    case 'google':
      return /^[0-9A-Za-z._-]{20,}$/.test(normalized);
    case 'openai':
      return /^sk-[0-9A-Za-z._-]{16,}$/.test(normalized);
    case 'anthropic':
      return /^sk-ant-[0-9A-Za-z._-]{16,}$/.test(normalized);
  }
}

export async function saveDeckToIndexedDb(deck: DeckDocument): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_DECKS, 'readwrite');
      tx.objectStore(STORE_DECKS).put(deck);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    localStorage.setItem(`incarvas_deck_${deck.id}`, JSON.stringify(deck));
  }
}

export async function loadDeckFromIndexedDb(deckId: string): Promise<DeckDocument | null> {
  try {
    const db = await openDb();
    const deck = await new Promise<DeckDocument | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE_DECKS, 'readonly');
      const req = tx.objectStore(STORE_DECKS).get(deckId);
      req.onsuccess = () => resolve(req.result as DeckDocument | undefined);
      req.onerror = () => reject(req.error);
    });
    db.close();
    if (deck) return deck;
  } catch {
    // Fallback below
  }
  const raw = localStorage.getItem(`incarvas_deck_${deckId}`);
  return raw ? (JSON.parse(raw) as DeckDocument) : null;
}
