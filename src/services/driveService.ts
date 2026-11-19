import type { DeckDocument } from '../types/slide';
import {
  deleteSecret,
  loadSecret,
  saveSecret,
} from './cryptoStorage';

const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const DEFAULT_FOLDER_NAME = 'InCarvas_Presentations';

export class SecurityBoundaryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SecurityBoundaryError';
  }
}

export class SyncFolderMissingError extends Error {
  constructor() {
    super('SYNC_FOLDER_MISSING: 지정된 Google Drive 폴더가 삭제되었거나 찾을 수 없습니다.');
    this.name = 'SyncFolderMissingError';
  }
}

export interface DriveFileSummary {
  id: string;
  name: string;
  modifiedTime: string;
  parents?: string[];
}

interface GoogleAccountsOAuth2 {
  initTokenClient: (config: {
    client_id: string;
    scope: string;
    callback: (resp: { access_token?: string; error?: string }) => void;
  }) => { requestAccessToken: (opts?: { prompt?: string }) => void };
}

declare global {
  interface Window {
    google?: {
      accounts?: {
        oauth2?: GoogleAccountsOAuth2;
      };
    };
  }
}

function loadGisScript(): Promise<void> {
  if (window.google?.accounts?.oauth2) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      'script[data-gis-client="true"]',
    );
    if (existing) {
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener(
        'error',
        () => reject(new Error('Google Identity Services 스크립트 로드 실패')),
        { once: true },
      );
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.dataset.gisClient = 'true';
    script.onload = () => resolve();
    script.onerror = () =>
      reject(new Error('오프라인 상태이거나 Google Identity Services 로드에 실패했습니다.'));
    document.head.appendChild(script);
  });
}

export async function getStoredDriveToken(): Promise<string> {
  return loadSecret('oauth:google-drive-token');
}

export async function getStoredDriveClientId(): Promise<string> {
  return loadSecret('oauth:google-drive-client-id');
}

export async function getStoredDriveFolderId(): Promise<string> {
  return loadSecret('oauth:google-drive-folder-id');
}

export async function saveDriveClientId(clientId: string): Promise<void> {
  await saveSecret('oauth:google-drive-client-id', clientId);
}

export async function disconnectDriveAccount(): Promise<void> {
  await deleteSecret('oauth:google-drive-token');
  await deleteSecret('oauth:google-drive-folder-id');
}

export async function connectGoogleDrive(clientId: string): Promise<string> {
  const trimmedId = clientId.trim();
  if (!trimmedId) {
    throw new Error('Google OAuth Client ID를 먼저 입력해 주세요.');
  }
  await saveDriveClientId(trimmedId);
  await loadGisScript();

  const oauth2 = window.google?.accounts?.oauth2;
  if (!oauth2) {
    throw new Error('Google OAuth 클라이언트를 초기화할 수 없습니다.');
  }

  const token = await new Promise<string>((resolve, reject) => {
    const client = oauth2.initTokenClient({
      client_id: trimmedId,
      scope: DRIVE_SCOPE,
      callback: (resp) => {
        if (resp.error || !resp.access_token) {
          reject(new Error(resp.error || 'Google Drive 인증이 취소되었습니다.'));
          return;
        }
        resolve(resp.access_token);
      },
    });
    client.requestAccessToken({ prompt: 'consent' });
  });

  await saveSecret('oauth:google-drive-token', token);
  return token;
}

async function driveFetch(
  url: string,
  token: string,
  init: RequestInit = {},
): Promise<Response> {
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.headers ?? {}),
    },
  });
  if (res.status === 401) {
    await deleteSecret('oauth:google-drive-token');
    throw new Error('Google Drive 인증 토큰이 만료되었습니다. 다시 연결해 주세요.');
  }
  return res;
}

async function verifyTargetFolder(
  token: string,
  folderId: string,
): Promise<boolean> {
  const res = await driveFetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(folderId)}?fields=id,trashed`,
    token,
  );
  if (res.status === 404) return false;
  if (!res.ok) return false;
  const data = (await res.json()) as { id?: string; trashed?: boolean };
  return Boolean(data.id) && !data.trashed;
}

export async function ensureTargetFolder(
  token: string,
  allowCreate = true,
): Promise<string> {
  const existingFolderId = await getStoredDriveFolderId();
  if (existingFolderId) {
    const valid = await verifyTargetFolder(token, existingFolderId);
    if (!valid) {
      throw new SyncFolderMissingError();
    }
    return existingFolderId;
  }

  if (!allowCreate) {
    throw new SyncFolderMissingError();
  }

  const q = encodeURIComponent(
    `name='${DEFAULT_FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
  );
  const searchRes = await driveFetch(
    `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)`,
    token,
  );
  if (searchRes.ok) {
    const searchData = (await searchRes.json()) as {
      files?: Array<{ id: string }>;
    };
    const found = searchData.files?.[0]?.id;
    if (found) {
      await saveSecret('oauth:google-drive-folder-id', found);
      return found;
    }
  }

  const createRes = await driveFetch(
    'https://www.googleapis.com/drive/v3/files',
    token,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: DEFAULT_FOLDER_NAME,
        mimeType: 'application/vnd.google-apps.folder',
      }),
    },
  );
  if (!createRes.ok) {
    throw new Error(`Google Drive 작업 폴더 생성 실패 (${createRes.status})`);
  }
  const created = (await createRes.json()) as { id: string };
  await saveSecret('oauth:google-drive-folder-id', created.id);
  return created.id;
}

export async function resetDriveFolderBinding(): Promise<void> {
  await deleteSecret('oauth:google-drive-folder-id');
}

async function assertWithinFolderBoundary(
  token: string,
  fileId: string,
  targetFolderId: string,
): Promise<void> {
  const res = await driveFetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=id,parents,trashed`,
    token,
  );
  if (res.status === 404) {
    throw new SecurityBoundaryError('대상 파일을 찾을 수 없습니다.');
  }
  if (!res.ok) {
    throw new SecurityBoundaryError(`경로 경계 검증 실패 (${res.status})`);
  }
  const meta = (await res.json()) as { parents?: string[]; trashed?: boolean };
  if (meta.trashed || !meta.parents?.includes(targetFolderId)) {
    throw new SecurityBoundaryError(
      '허용된 앱 전용 폴더 경계 외부의 파일 접근이 차단되었습니다.',
    );
  }
}

export async function listDriveDecks(token: string): Promise<DriveFileSummary[]> {
  const folderId = await ensureTargetFolder(token, true);
  const q = encodeURIComponent(
    `'${folderId}' in parents and trashed = false and mimeType = 'application/json'`,
  );
  const res = await driveFetch(
    `https://www.googleapis.com/drive/v3/files?q=${q}&orderBy=modifiedTime desc&fields=files(id,name,modifiedTime,parents)`,
    token,
  );
  if (!res.ok) {
    throw new Error(`Google Drive 목록 조회 실패 (${res.status})`);
  }
  const data = (await res.json()) as { files?: DriveFileSummary[] };
  return (data.files ?? []).filter((f) => f.parents?.includes(folderId));
}

export async function saveDeckToGoogleDrive(
  token: string,
  deck: DeckDocument,
): Promise<{ fileId: string; fileName: string }> {
  const folderId = await ensureTargetFolder(token, true);
  const safeName = `${(deck.title || 'InCarvas_Deck').replace(/[^\w가-힣\-_ ]/g, '')}.incarvas.json`;

  const existingFiles = await listDriveDecks(token);
  const existing = existingFiles.find((f) => f.name === safeName);

  const jsonBody = JSON.stringify(deck, null, 2);

  if (existing) {
    await assertWithinFolderBoundary(token, existing.id, folderId);
    const updateRes = await driveFetch(
      `https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(existing.id)}?uploadType=media`,
      token,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: jsonBody,
      },
    );
    if (!updateRes.ok) {
      throw new Error(`Google Drive 파일 업데이트 실패 (${updateRes.status})`);
    }
    return { fileId: existing.id, fileName: safeName };
  }

  const boundary = `incarvas_${Date.now()}`;
  const metadata = JSON.stringify({
    name: safeName,
    mimeType: 'application/json',
    parents: [folderId],
  });

  const multipartBody = [
    `--${boundary}`,
    'Content-Type: application/json; charset=UTF-8',
    '',
    metadata,
    `--${boundary}`,
    'Content-Type: application/json; charset=UTF-8',
    '',
    jsonBody,
    `--${boundary}--`,
  ].join('\r\n');

  const createRes = await driveFetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart',
    token,
    {
      method: 'POST',
      headers: {
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body: multipartBody,
    },
  );

  if (!createRes.ok) {
    throw new Error(`Google Drive 업로드 실패 (${createRes.status})`);
  }
  const created = (await createRes.json()) as { id: string };
  return { fileId: created.id, fileName: safeName };
}

export async function loadDeckFromGoogleDrive(
  token: string,
  fileId: string,
): Promise<DeckDocument> {
  const folderId = await ensureTargetFolder(token, false);
  await assertWithinFolderBoundary(token, fileId, folderId);

  const res = await driveFetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`,
    token,
  );
  if (!res.ok) {
    throw new Error(`Google Drive 파일 불러오기 실패 (${res.status})`);
  }
  const parsed = (await res.json()) as DeckDocument;
  if (!parsed || !Array.isArray(parsed.slides) || parsed.slides.length === 0) {
    throw new Error('올바른 InCarvas 프레젠테이션 JSON 파일이 아닙니다.');
  }
  return parsed;
}
