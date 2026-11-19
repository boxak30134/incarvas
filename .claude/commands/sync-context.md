`vibe-context/AGENTS.md`의 **5.2 공유 저장소 최신 지침 수신 전략 (Pull Pipeline)**을 실행하세요:
1. `git -C vibe-context status --porcelain`으로 미커밋 변경사항 여부를 확인합니다.
2. 변경사항이 있다면 `git -C vibe-context stash`로 임시 보관한 뒤 `git -C vibe-context pull origin main`을 실행합니다.
3. 새로 추가되거나 수정된 `rules/`, `patterns/`, `majors/`, `AGENTS.md` 요약(3줄 이내)을 보고합니다.
