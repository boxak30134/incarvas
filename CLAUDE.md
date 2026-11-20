@vibe-context/AGENTS.md

> **[시스템 지시]** 이 프로젝트의 모든 코딩 규칙과 작업 지침은 `vibe-context/AGENTS.md`에 정의되어 있습니다. 사용자의 요청을 처리하기 전에 반드시 `vibe-context/AGENTS.md` 파일을 먼저 읽고 지침을 따르세요.

## 프로젝트 고유 작업 규칙 (InCarvas)

1. **브랜치 분리 푸시 원칙 (Feature Branch Push)**:
   - `incarvas` 저장소에 변경 사항을 커밋·푸시할 때는 `main` 브랜치에 직접 커밋·푸시하지 않는다.
   - 반드시 작업 성격에 맞는 새 브랜치(`feat/<기능명>`, `fix/<이슈명>`)를 생성해 푸시(`git push -u origin <브랜치명>`)한 뒤 PR 생성 링크를 안내한다.
2. **Google Drive 무설정(Zero-Config) OAuth 원칙**:
   - 사용자에게 Google OAuth Client ID 입력창을 절대 노출하지 않는다.
   - `VITE_GOOGLE_CLIENT_ID` 환경변수(및 내장 공개 Client ID 폴백)를 사용해 원클릭으로 Google Drive 권한 동의 창(`drive.file` 최소 권한)만 띄운다.

