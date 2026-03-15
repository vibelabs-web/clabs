// @TASK Session Watcher - Claude Code 세션 파일 모니터링
// Claude Code의 세션 JSONL 파일을 감시하여 실시간 사용량 추적

import fs from 'fs';
import path from 'path';
import os from 'os';
import { BrowserWindow } from 'electron';

interface SessionUsage {
  inputTokens: number;       // 마지막 API 호출의 input (= 현재 컨텍스트 크기)
  outputTokens: number;      // 누적 출력 토큰
  cacheReadTokens: number;   // 마지막 캐시 읽기
  cacheCreationTokens: number; // 마지막 캐시 생성
  totalTokens: number;       // 컨텍스트 사용량 (input + cache)
  messageCount: number;
}

interface UsageEntry {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}

export class SessionWatcher {
  private watchedFile: string | null = null;
  private pollInterval: NodeJS.Timeout | null = null;
  private lastPosition: number = 0;
  private lastMtime: number = 0;
  private usage: SessionUsage = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    totalTokens: 0,
    messageCount: 0
  };
  private projectPath: string | null = null;
  private checkInterval: NodeJS.Timeout | null = null;

  /**
   * Git 루트 디렉토리 찾기
   */
  private findGitRoot(startPath: string): string | null {
    let currentPath = startPath;
    while (currentPath !== '/') {
      if (fs.existsSync(path.join(currentPath, '.git'))) {
        return currentPath;
      }
      currentPath = path.dirname(currentPath);
    }
    return null;
  }

  /**
   * 프로젝트 경로로부터 세션 파일 경로 찾기
   */
  private findSessionFile(projectPath: string): string | null {
    try {
      // ~ 또는 $HOME을 실제 홈 디렉토리로 확장
      let resolvedPath = projectPath;
      if (projectPath === '~' || projectPath.startsWith('~/')) {
        resolvedPath = projectPath.replace(/^~/, os.homedir());
      }

      // 여러 가능한 프로젝트 디렉토리 검색 (현재 경로, git 루트, 부모 디렉토리들)
      const pathsToTry: string[] = [resolvedPath];

      // Git 루트 추가
      const gitRoot = this.findGitRoot(resolvedPath);
      if (gitRoot && gitRoot !== resolvedPath) {
        pathsToTry.push(gitRoot);
      }

      // 부모 디렉토리들도 추가 (최대 3단계)
      let parentPath = path.dirname(resolvedPath);
      for (let i = 0; i < 3 && parentPath !== '/'; i++) {
        if (!pathsToTry.includes(parentPath)) {
          pathsToTry.push(parentPath);
        }
        parentPath = path.dirname(parentPath);
      }

      console.log('Searching for session in paths:', pathsToTry);

      for (const tryPath of pathsToTry) {
        // 프로젝트 경로를 Claude 형식으로 변환:
        // /Users/foo/bar_baz -> -Users-foo-bar-baz
        const encodedPath = tryPath.replace(/\//g, '-').replace(/_/g, '-');
        const projectDir = path.join(os.homedir(), '.claude', 'projects', encodedPath);

        console.log('Checking:', projectDir);

        if (!fs.existsSync(projectDir)) {
          continue;
        }

        // sessions-index.json에서 현재 프로젝트 경로와 일치하는 세션 찾기
        const indexPath = path.join(projectDir, 'sessions-index.json');
        if (fs.existsSync(indexPath)) {
          const indexContent = fs.readFileSync(indexPath, 'utf-8');
          const index = JSON.parse(indexContent);

          if (index.entries && index.entries.length > 0) {
            // 현재 프로젝트 경로와 일치하는 세션들 필터링
            const matchingSessions = index.entries.filter((entry: any) =>
              entry.projectPath === resolvedPath
            );

            if (matchingSessions.length > 0) {
              // 가장 최근 세션 선택
              const latestSession = matchingSessions.reduce((latest: any, entry: any) => {
                if (!latest) return entry;
                return new Date(entry.modified) > new Date(latest.modified) ? entry : latest;
              }, null);

              if (latestSession?.fullPath) {
                console.log('Found matching session:', latestSession.fullPath);
                return latestSession.fullPath;
              }
            }

            // 일치하는 세션이 없으면 가장 최근 세션 사용 (fallback)
            const latestSession = index.entries.reduce((latest: any, entry: any) => {
              if (!latest) return entry;
              return new Date(entry.modified) > new Date(latest.modified) ? entry : latest;
            }, null);

            if (latestSession?.fullPath) {
              console.log('Found session (fallback):', latestSession.fullPath);
              return latestSession.fullPath;
            }
          }
        }

        // fallback: 디렉토리에서 .jsonl 파일 직접 찾기
        const files = fs.readdirSync(projectDir);
        const jsonlFiles = files
          .filter(f => f.endsWith('.jsonl'))
          .map(f => ({
            name: f,
            path: path.join(projectDir, f),
            mtime: fs.statSync(path.join(projectDir, f)).mtime
          }))
          .sort((a, b) => b.mtime.getTime() - a.mtime.getTime());

        if (jsonlFiles.length > 0) {
          console.log('Found session (direct):', jsonlFiles[0].path);
          return jsonlFiles[0].path;
        }
      }

      console.log('No session file found for:', resolvedPath);
      return null;
    } catch (error) {
      console.error('Error finding session file:', error);
      return null;
    }
  }

  /**
   * JSONL 파일의 새 라인 읽기 및 파싱
   */
  private parseNewEntries(): void {
    if (!this.watchedFile || !fs.existsSync(this.watchedFile)) {
      return;
    }

    try {
      const stats = fs.statSync(this.watchedFile);
      const fileSize = stats.size;

      if (fileSize <= this.lastPosition) {
        return;
      }

      // 새로운 부분만 읽기
      const fd = fs.openSync(this.watchedFile, 'r');
      const bufferSize = fileSize - this.lastPosition;
      const buffer = Buffer.alloc(bufferSize);
      fs.readSync(fd, buffer, 0, bufferSize, this.lastPosition);
      fs.closeSync(fd);

      const newContent = buffer.toString('utf-8');
      const lines = newContent.split('\n').filter(line => line.trim());

      for (const line of lines) {
        try {
          const entry = JSON.parse(line);

          if (entry.message?.usage) {
            const usage: UsageEntry = entry.message.usage;

            // 컨텍스트 = 마지막 API 호출의 input_tokens (전체 대화 기록 포함)
            const inputTokens = usage.input_tokens || 0;
            const cacheRead = usage.cache_read_input_tokens || 0;
            const cacheCreate = usage.cache_creation_input_tokens || 0;

            // input_tokens가 이전보다 크면 업데이트 (컨텍스트가 커짐)
            if (inputTokens > 0) {
              this.usage.inputTokens = inputTokens;
              this.usage.cacheReadTokens = cacheRead;
              this.usage.cacheCreationTokens = cacheCreate;
              // 컨텍스트 사용량 = input + cache_read + cache_creation
              this.usage.totalTokens = inputTokens + cacheRead + cacheCreate;
            }

            // 출력 토큰은 누적
            this.usage.outputTokens += usage.output_tokens || 0;
            this.usage.messageCount++;

            console.log('Context updated:', this.usage.totalTokens, 'tokens (input:', inputTokens, '+ cache:', cacheRead + cacheCreate, ')');

            // 렌더러에 업데이트 전송
            this.broadcastUsage();
          }
        } catch {
          // JSON 파싱 실패 무시 (불완전한 라인)
        }
      }

      this.lastPosition = fileSize;
    } catch (error) {
      console.error('Error parsing session file:', error);
    }
  }

  /**
   * 렌더러 프로세스에 사용량 브로드캐스트
   */
  private broadcastUsage(): void {
    const windows = BrowserWindow.getAllWindows();

    windows.forEach(win => {
      win.webContents.send('usage:update', {
        tokensUsed: this.usage.totalTokens,
        contextLimit: 1000000,
        dailyTokensUsed: this.usage.totalTokens,
        inputTokens: this.usage.inputTokens,
        outputTokens: this.usage.outputTokens,
        cacheReadTokens: this.usage.cacheReadTokens,
        cacheCreationTokens: this.usage.cacheCreationTokens,
        messageCount: this.usage.messageCount
      });
    });
  }

  /**
   * 프로젝트 세션 감시 시작
   */
  start(projectPath: string): boolean {
    // Windows에서는 세션 감시 비활성화 (경로 처리 문제로 앱 프리징 발생)
    if (process.platform === 'win32') {
      console.log('Session watcher disabled on Windows');
      return false;
    }

    this.stop(); // 기존 감시 중지

    this.projectPath = projectPath;

    // 가장 최신 세션 파일 찾기 (항상 최신 사용)
    const sessionFile = this.findNewestSessionFile(projectPath);

    if (!sessionFile) {
      console.log('No session file found, starting periodic check');
      this.startPeriodicCheck(projectPath);
      return false;
    }

    return this.watchFile(sessionFile);
  }

  /**
   * 파일 감시 시작 (폴링 방식)
   */
  private watchFile(sessionFile: string): boolean {
    try {
      this.watchedFile = sessionFile;

      // 기존 내용을 먼저 읽어서 현재 사용량 계산
      this.parseExistingEntries();

      // 현재 위치 및 수정 시간 저장
      const stats = fs.statSync(sessionFile);
      this.lastPosition = stats.size;
      this.lastMtime = stats.mtimeMs;

      // 폴링으로 파일 변경 감시 (500ms 간격)
      this.pollInterval = setInterval(() => {
        this.checkForChanges();
      }, 500);

      console.log('Watching session file (polling):', sessionFile);
      console.log('Initial usage:', this.usage.totalTokens, 'tokens');

      // 초기 브로드캐스트
      this.broadcastUsage();

      return true;
    } catch (error) {
      console.error('Error starting session watch:', error);
      return false;
    }
  }

  /**
   * 파일 감시 시작 (사용량 유지, 새 엔트리만 추적)
   */
  private watchFileWithoutReset(sessionFile: string): boolean {
    try {
      this.watchedFile = sessionFile;

      // 기존 내용은 파싱하지 않고, 파일 끝부터 새 엔트리만 추적
      const stats = fs.statSync(sessionFile);
      this.lastPosition = stats.size;
      this.lastMtime = stats.mtimeMs;

      // 폴링으로 파일 변경 감시 (500ms 간격)
      this.pollInterval = setInterval(() => {
        this.checkForChanges();
      }, 500);

      console.log('Watching session file (continuing):', sessionFile);
      console.log('Accumulated usage:', this.usage.totalTokens, 'tokens');

      return true;
    } catch (error) {
      console.error('Error starting session watch:', error);
      return false;
    }
  }

  private sessionCheckCounter: number = 0;

  /**
   * 파일 변경 체크 (폴링) - 항상 최신 세션 파일의 마지막 usage를 읽음
   */
  private checkForChanges(): void {
    if (!this.projectPath) return;

    try {
      // 항상 최신 세션 파일 찾기
      const newestSession = this.findNewestSessionFile(this.projectPath);
      if (!newestSession) return;

      // 다른 세션으로 전환되었으면 로그
      if (newestSession !== this.watchedFile) {
        console.log('Switched to session:', path.basename(newestSession));
        this.watchedFile = newestSession;
      }

      // 최신 세션 파일에서 마지막 usage 읽기
      this.parseLatestUsage(newestSession);
    } catch (error) {
      // 파일 접근 오류 무시
    }
  }

  /**
   * 세션 파일에서 마지막 usage 정보만 추출
   */
  private parseLatestUsage(sessionFile: string): void {
    try {
      const content = fs.readFileSync(sessionFile, 'utf-8');
      const lines = content.split('\n').filter(line => line.trim());

      let latestInput = 0;
      let latestCacheRead = 0;
      let latestCacheCreate = 0;
      let totalOutput = 0;
      let messageCount = 0;

      // 모든 라인을 읽어서 마지막 usage와 총 output 계산
      for (const line of lines) {
        try {
          const entry = JSON.parse(line);
          if (entry.message?.usage) {
            const usage = entry.message.usage;

            // 마지막 input/cache 값 저장 (컨텍스트)
            if (usage.input_tokens !== undefined) {
              latestInput = usage.input_tokens || 0;
              latestCacheRead = usage.cache_read_input_tokens || 0;
              latestCacheCreate = usage.cache_creation_input_tokens || 0;
            }

            // output은 누적 (마지막 값만)
            if (usage.output_tokens) {
              totalOutput = usage.output_tokens;
            }
            messageCount++;
          }
        } catch {
          // JSON 파싱 실패 무시
        }
      }

      const newTotal = latestInput + latestCacheRead + latestCacheCreate;

      // 값이 변경되었을 때만 업데이트
      if (newTotal !== this.usage.totalTokens) {
        this.usage.inputTokens = latestInput;
        this.usage.cacheReadTokens = latestCacheRead;
        this.usage.cacheCreationTokens = latestCacheCreate;
        this.usage.totalTokens = newTotal;
        this.usage.outputTokens = totalOutput;
        this.usage.messageCount = messageCount;

        console.log(`Context: ${newTotal} tokens (in=${latestInput}, cache=${latestCacheRead + latestCacheCreate})`);
        this.broadcastUsage();
      }
    } catch (error) {
      console.error('Error parsing session:', error);
    }
  }

  /**
   * 더 최신 세션 파일이 있는지 확인하고 전환
   */
  private checkForNewerSession(): void {
    if (!this.projectPath) return;

    const newerSession = this.findNewestSessionFile(this.projectPath);

    if (!newerSession) {
      console.log('No session file found');
      return;
    }

    if (newerSession !== this.watchedFile) {
      console.log('Switching to newer session file:', newerSession);
      console.log('(was watching:', this.watchedFile, ')');
      console.log('Keeping accumulated usage:', this.usage.totalTokens, 'tokens');

      // 기존 감시 중지하고 새 파일로 전환
      if (this.pollInterval) {
        clearInterval(this.pollInterval);
        this.pollInterval = null;
      }

      // 사용량은 유지하고 새 세션 감시 시작 (누적)
      this.lastPosition = 0;
      this.lastMtime = 0;

      this.watchFileWithoutReset(newerSession);
    }
  }

  /**
   * 가장 최신 세션 파일 찾기
   */
  private findNewestSessionFile(projectPath: string): string | null {
    try {
      let resolvedPath = projectPath;
      if (projectPath === '~' || projectPath.startsWith('~/')) {
        resolvedPath = projectPath.replace(/^~/, os.homedir());
      }

      const pathsToTry: string[] = [resolvedPath];
      const gitRoot = this.findGitRoot(resolvedPath);
      if (gitRoot && gitRoot !== resolvedPath) {
        pathsToTry.push(gitRoot);
      }

      let newestFile: { path: string; mtime: Date } | null = null;

      for (const tryPath of pathsToTry) {
        const encodedPath = tryPath.replace(/\//g, '-').replace(/_/g, '-');
        const projectDir = path.join(os.homedir(), '.claude', 'projects', encodedPath);

        if (!fs.existsSync(projectDir)) continue;

        const files = fs.readdirSync(projectDir);
        for (const f of files) {
          if (!f.endsWith('.jsonl')) continue;
          const filePath = path.join(projectDir, f);
          const mtime = fs.statSync(filePath).mtime;
          if (!newestFile || mtime > newestFile.mtime) {
            newestFile = { path: filePath, mtime };
          }
        }
      }

      return newestFile?.path || null;
    } catch {
      return null;
    }
  }

  /**
   * 기존 세션 파일 전체 읽기 및 파싱
   */
  private parseExistingEntries(): void {
    if (!this.watchedFile || !fs.existsSync(this.watchedFile)) {
      return;
    }

    try {
      const content = fs.readFileSync(this.watchedFile, 'utf-8');
      const lines = content.split('\n').filter(line => line.trim());

      console.log(`Parsing ${lines.length} existing entries...`);

      let lastInputTokens = 0;
      let lastCacheRead = 0;
      let lastCacheCreate = 0;

      for (const line of lines) {
        try {
          const entry = JSON.parse(line);

          if (entry.message?.usage) {
            const usage: UsageEntry = entry.message.usage;

            // 마지막 API 호출의 input이 현재 컨텍스트
            if (usage.input_tokens && usage.input_tokens > 0) {
              lastInputTokens = usage.input_tokens;
              lastCacheRead = usage.cache_read_input_tokens || 0;
              lastCacheCreate = usage.cache_creation_input_tokens || 0;
            }

            // 출력 토큰은 누적
            this.usage.outputTokens += usage.output_tokens || 0;
            this.usage.messageCount++;
          }
        } catch {
          // JSON 파싱 실패 무시
        }
      }

      this.usage.inputTokens = lastInputTokens;
      this.usage.cacheReadTokens = lastCacheRead;
      this.usage.cacheCreationTokens = lastCacheCreate;
      this.usage.totalTokens = lastInputTokens + lastCacheRead + lastCacheCreate;
      console.log(`Parsed: context=${this.usage.totalTokens} tokens (input=${lastInputTokens}, cache=${lastCacheRead + lastCacheCreate}) from ${this.usage.messageCount} messages`);
    } catch (error) {
      console.error('Error parsing existing entries:', error);
    }
  }

  /**
   * 세션 파일이 생성될 때까지 주기적으로 체크
   */
  private startPeriodicCheck(projectPath: string): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
    }

    // 더 빠른 주기로 체크 (1초마다)
    this.checkInterval = setInterval(() => {
      const sessionFile = this.findNewestSessionFile(projectPath);
      if (sessionFile) {
        console.log('Session file found:', sessionFile);
        if (this.checkInterval) {
          clearInterval(this.checkInterval);
          this.checkInterval = null;
        }
        this.watchFile(sessionFile);
      }
    }, 1000);
  }

  /**
   * 감시 중지
   */
  stop(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }

    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }

    this.watchedFile = null;
    this.lastPosition = 0;
    this.lastMtime = 0;
    this.usage = {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      totalTokens: 0,
      messageCount: 0
    };
  }

  /**
   * 현재 사용량 조회
   */
  getUsage(): SessionUsage {
    return { ...this.usage };
  }

  /**
   * 사용량 초기화
   */
  resetUsage(): void {
    this.usage = {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      totalTokens: 0,
      messageCount: 0
    };
    this.broadcastUsage();
  }

  /**
   * 현재 사용량을 특정 윈도우에 전송
   */
  sendUsageTo(webContents: Electron.WebContents): void {
    webContents.send('usage:update', {
      tokensUsed: this.usage.totalTokens,
      contextLimit: 1000000,
      dailyTokensUsed: this.usage.totalTokens,
      inputTokens: this.usage.inputTokens,
      outputTokens: this.usage.outputTokens,
      cacheReadTokens: this.usage.cacheReadTokens,
      cacheCreationTokens: this.usage.cacheCreationTokens,
      messageCount: this.usage.messageCount
    });
  }
}

// 싱글톤 인스턴스
let sessionWatcher: SessionWatcher | null = null;

export function getSessionWatcher(): SessionWatcher {
  if (!sessionWatcher) {
    sessionWatcher = new SessionWatcher();
  }
  return sessionWatcher;
}
