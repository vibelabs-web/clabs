# UpdateManager - GitHub Releases Auto-Update

UpdateManager는 GitHub Releases API를 사용하여 자동 업데이트 기능을 제공하는 모듈입니다.

## 기능

- ✅ GitHub Releases에서 최신 버전 확인
- ✅ 업데이트 파일 다운로드 (진행률 표시)
- ✅ 플랫폼별 자동 설치 (macOS, Windows, Linux)
- ✅ 자동 업데이트 체크 (주기적)
- ✅ Semantic Versioning 지원

## 사용 방법

### 1. 기본 설정

```typescript
import { UpdateManager } from './update-manager';

const updateManager = new UpdateManager({
  owner: 'claudelabs',
  repo: 'clabs',
  currentVersion: '1.0.0',
});
```

### 2. 업데이트 확인

```typescript
const updateInfo = await updateManager.checkForUpdates();

if (updateInfo) {
  console.log(`새 버전: ${updateInfo.version}`);
  console.log(`릴리즈 노트: ${updateInfo.releaseNotes}`);
  console.log(`다운로드 URL: ${updateInfo.downloadUrl}`);
}
```

### 3. 업데이트 다운로드

```typescript
const filePath = await updateManager.downloadUpdate(
  updateInfo.downloadUrl,
  (progress) => {
    console.log(`다운로드 진행률: ${progress.percent.toFixed(2)}%`);
    console.log(`전송: ${progress.transferred} / ${progress.total} bytes`);
  }
);
```

### 4. 업데이트 설치

```typescript
await updateManager.installUpdate(filePath);
// 앱이 자동으로 종료되고 설치 프로그램이 실행됩니다
```

### 5. 자동 업데이트 체크

```typescript
// 6시간마다 자동 체크
const SIX_HOURS = 6 * 60 * 60 * 1000;
updateManager.enableAutoCheck(SIX_HOURS);

// 중지
updateManager.disableAutoCheck();
```

## API 레퍼런스

### `checkForUpdates(): Promise<UpdateInfo | null>`

GitHub Releases에서 최신 버전을 확인합니다.

**반환값:**
- `UpdateInfo`: 새 버전이 있을 경우
- `null`: 업데이트가 없거나 에러 발생 시

**UpdateInfo 타입:**
```typescript
{
  version: string;        // 버전 번호 (예: "2.0.0")
  releaseNotes: string;   // 릴리즈 노트
  downloadUrl: string;    // 다운로드 URL
  publishedAt: string;    // 배포 일시
  fileSize: number;       // 파일 크기 (bytes)
}
```

### `downloadUpdate(downloadUrl: string, onProgress?: (progress: DownloadProgress) => void): Promise<string>`

업데이트 파일을 다운로드합니다.

**매개변수:**
- `downloadUrl`: 다운로드 URL
- `onProgress`: 진행률 콜백 (선택)

**반환값:**
- 다운로드된 파일 경로

**DownloadProgress 타입:**
```typescript
{
  percent: number;      // 진행률 (0-100)
  transferred: number;  // 전송된 바이트
  total: number;        // 전체 바이트
}
```

### `installUpdate(filePath: string): Promise<boolean>`

다운로드된 업데이트를 설치합니다.

**매개변수:**
- `filePath`: 설치 파일 경로

**반환값:**
- `true`: 설치 성공
- 에러 발생 시 예외 throw

**플랫폼별 동작:**
- **macOS**: DMG 파일을 열고 앱 종료
- **Windows**: 설치 프로그램 실행 후 앱 종료
- **Linux**: AppImage를 실행하거나 deb 패키지 설치

### `enableAutoCheck(intervalMs: number): void`

자동 업데이트 체크를 활성화합니다.

**매개변수:**
- `intervalMs`: 체크 주기 (밀리초)

### `disableAutoCheck(): void`

자동 업데이트 체크를 비활성화합니다.

## 플랫폼 지원

| 플랫폼 | 지원 파일 형식 | 자동 설치 |
|--------|---------------|----------|
| macOS | .dmg | ✅ |
| Windows | .exe | ✅ |
| Linux | .AppImage, .deb | ✅ |

## 에러 처리

UpdateManager는 모든 에러를 gracefully 처리합니다:

- 네트워크 에러 → `null` 반환
- API 레이트 리밋 → 경고 로그 출력 후 `null` 반환
- 다운로드 실패 → 예외 throw
- 설치 실패 → 예외 throw

## 테스트

```bash
npm run test:main
```

13개의 테스트가 모두 통과해야 합니다:
- checkForUpdates (4 tests)
- downloadUpdate (2 tests)
- installUpdate (3 tests)
- version comparison (2 tests)
- auto-update check (2 tests)

## 보안

- GitHub API는 HTTPS를 사용합니다
- 다운로드된 파일은 임시 디렉토리에 저장됩니다
- 설치는 사용자 권한으로 실행됩니다 (Linux deb 제외)

## 주의사항

1. **GitHub API 레이트 리밋**
   - 인증 없이 시간당 60회 제한
   - 필요시 GitHub Token 추가 가능

2. **버전 형식**
   - Semantic Versioning 사용 (X.Y.Z)
   - 'v' 접두사는 자동으로 제거됩니다

3. **플랫폼 감지**
   - 릴리즈 파일명에 플랫폼 정보 포함 필요
   - 예: `clabs-2.0.0-mac.dmg`, `clabs-2.0.0-win.exe`

## 통합 예제

전체 통합 예제는 `src/main/examples/update-manager-usage.ts`를 참조하세요.
