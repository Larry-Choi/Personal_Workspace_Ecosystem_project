# Underdesk Music

Tauri + React + TypeScript로 만든 작은 독립 YouTube 음악 플레이어입니다.

## 기능

- Chrome과 별도 프로세스/앱 창으로 실행
- 작업표시줄과 Alt+Tab에 `Underdesk Music`으로 표시
- YouTube iframe 재생
- 플레이리스트 추가, 삭제, 순서 변경
- 플레이리스트 자동 저장
- always-on-top 토글
- 일반 모드/미니 모드 전환

## 실행

Rust가 설치되어 있어야 Tauri 데스크탑 앱을 실행할 수 있습니다.

```powershell
npm install
npm run tauri:dev
```

빌드는 다음 명령을 사용합니다.

```powershell
npm run tauri:build
```

현재 PC에서 `node`와 `npm`은 확인됐지만 `rustc`와 `cargo`는 PATH에서 찾지 못했습니다.
Rust 설치 후 새 터미널을 열어 다시 실행하세요.
