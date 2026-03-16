# Clabs — Claude Labs Skillpack GUI

Claude Code CLI를 위한 데스크톱 GUI 애플리케이션. 터미널 기반의 Claude Code를 시각적 인터페이스로 감싸, 스킬팩 관리·MCP 서버 통합·다중 패인 터미널·프로젝트 관리를 하나의 앱에서 제공합니다.

## 주요 기능

### 통합 터미널 (Multi-Pane)
- **xterm.js 기반 터미널**을 Electron 앱 내에서 실행
- **다중 패인 분할** — 수평/수직으로 터미널을 분할하여 동시 작업
- **한글 IME 지원** — Unicode11 애드온으로 한글 입력 완벽 처리
- **PTY Pool 관리** — node-pty 기반 프로세스 풀로 패인별 독립 셸 운영

### 스킬팩 관리
- **80+ AI 스킬** 시각적 브라우징 및 실행
- 카테고리별 분류 — 개발, 기획, 디자인, 보안, 인프라 등
- 터미널에 원클릭 실행 — 스킬 선택 시 활성 터미널 패인으로 자동 전송

### MCP 서버 통합
- **Context7** — 최신 라이브러리 문서 실시간 검색
- **Gemini** — Google Gemini AI 모델 연동
- **Stitch** — UI 프로토타이핑 도구
- **GitHub** — PR/이슈 관리
- 설정 상태 확인 및 원클릭 셋업

### 프로젝트 관리
- 최근 프로젝트 목록 (최대 20개)
- 폴더 선택 다이얼로그로 프로젝트 추가
- 프로젝트 전환 시 자동 PTY 재시작 및 패인 리셋

### CLI 명령어 빌더
- Claude Code CLI 명령어를 GUI로 조합
- 명령어 히스토리 저장/검색 (최대 50개)
- 프롬프트 제안 (ghost text)

### 사용량 모니터링
- 세션별 토큰 사용량 (input/output/cache) 실시간 추적
- Anthropic API 5시간/7일 사용률 표시
- 태스크 지속 시간 타이머

## 기술 스택

| 레이어 | 기술 |
|--------|------|
| **Framework** | Electron 28 |
| **Renderer** | React 19 + TypeScript 5 |
| **빌드** | Vite 5 + electron-builder |
| **스타일링** | TailwindCSS 3 |
| **상태관리** | Zustand 4 |
| **터미널** | xterm.js 5 + node-pty |
| **테스트** | Vitest + Playwright |
| **IPC** | Electron IPC (contextIsolation + preload) |

## 아키텍처

```
src/
├── main/           # Electron Main Process
│   ├── index.ts           # 앱 진입점, 윈도우 생성
│   ├── ipc/handlers.ts    # IPC 핸들러 (PTY, Config, License, MCP 등)
│   ├── pty-manager.ts     # 단일 PTY 관리
│   ├── pty-pool-manager.ts # 다중 패인 PTY 풀
│   ├── skill-scanner.ts   # 스킬팩 파일 스캐너
│   ├── session-watcher.ts # Claude CLI 세션 모니터링
│   ├── setup-service.ts   # 초기 셋업 (스킬팩 설치, MCP 구성)
│   ├── updater.ts         # 자동 업데이트
│   └── stores/            # electron-store 기반 영속 저장소
├── renderer/       # React UI (Renderer Process)
│   ├── components/
│   │   ├── layout/        # MainLayout, TitleBar, StatusBar, ToolbarBar
│   │   ├── terminal/      # TerminalView, SplitPaneContainer, InputBox
│   │   ├── project/       # ProjectSelector
│   │   ├── settings/      # SettingsModal
│   │   └── skills/        # 스킬 패널
│   ├── stores/            # Zustand 스토어 (pane, project, theme, terminal 등)
│   └── pages/             # MainPage, SettingsPage, HelpPage 등
├── shared/         # Main-Renderer 공유 타입
│   ├── types.ts           # Config, License, Project, UpdateInfo
│   ├── claude-cli.ts      # CLI 관련 타입
│   └── pane-types.ts      # 패인 트리 타입
└── preload/        # contextBridge API 노출
```

## 시작하기

### 필수 조건

- **Node.js** 18 이상
- **Claude Code CLI** 설치 (`npm install -g @anthropic-ai/claude-code`)

### 개발 모드

```bash
npm install
npm run electron:dev
```

Vite 개발 서버(`localhost:5173`)가 뜬 후 Electron 윈도우가 자동으로 열립니다.

### 빌드

```bash
# macOS
npm run build:mac

# Windows
npm run build:win

# Linux
npm run build:linux

# 전체 플랫폼
npm run build:all
```

빌드 결과물은 `release/` 디렉토리에 생성됩니다.

### 테스트

```bash
# 전체 테스트
npm test

# Main 프로세스 테스트
npm run test:main

# Renderer 테스트
npm run test:renderer

# E2E 테스트
npm run test:e2e
```

## 설치 (프로덕션)

### macOS
```bash
open clabs-{version}.dmg
# Applications 폴더로 드래그 앤 드롭
```

### Windows
```powershell
# NSIS 인스톨러 실행
clabs-Setup-{version}.exe
```

### Linux
```bash
# AppImage
chmod +x clabs-{version}.AppImage
./clabs-{version}.AppImage

# Debian/Ubuntu
sudo dpkg -i clabs_{version}_amd64.deb
```

## 워크플로우

```
1. 앱 실행 → 첫 실행 시 스킬팩 자동 설치
2. 프로젝트 폴더 선택 → PTY 셸 자동 시작
3. InputBox에 Claude Code 명령어 입력 or 스킬 패널에서 클릭 실행
4. 다중 패인 분할로 동시 작업
5. StatusBar에서 토큰 사용량 실시간 확인
6. 설정에서 MCP 서버 추가/관리
```

## 시스템 요구사항

| 플랫폼 | 최소 버전 |
|---------|-----------|
| macOS | 10.15 (Catalina) |
| Windows | 10 (64-bit) |
| Linux | Ubuntu 20.04 LTS |

## 라이선스

MIT License
