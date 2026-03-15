// PtyPoolManager - 다중 PTY 관리 (paneId별 독립 PTY)

import * as pty from 'node-pty';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';

interface PtyEntry {
  process: pty.IPty;
  dataCallbacks: Array<(data: string) => void>;
  exitCallbacks: Array<(exitCode: number) => void>;
}

export class PtyPoolManager {
  private pool: Map<string, PtyEntry> = new Map();

  /**
   * paneId에 대해 새 PTY 프로세스 생성
   */
  spawn(paneId: string, cwd?: string): number {
    // 이미 해당 paneId에 PTY가 있으면 먼저 종료
    if (this.pool.has(paneId)) {
      this.kill(paneId);
    }

    const homeDir = os.homedir();
    const workDir = cwd && cwd !== '~' ? cwd : homeDir;

    // OS별 셸 설정 (pty-manager.ts와 동일 로직)
    const isWindows = process.platform === 'win32';
    let shell: string;
    let shellArgs: string[] = [];

    if (isWindows) {
      shell = 'powershell.exe';
      shellArgs = ['-NoLogo', '-NoProfile'];
    } else if (process.platform === 'darwin') {
      shell = '/bin/zsh';
      shellArgs = [];
    } else {
      shell = '/bin/bash';
      shellArgs = [];
    }

    // 환경변수 설정 (pty-manager.ts와 동일 로직)
    const env: { [key: string]: string } = {};

    if (isWindows) {
      for (const [key, value] of Object.entries(process.env)) {
        if (value !== undefined) env[key] = value;
      }
      env.TERM = 'xterm-256color';
      const npmGlobalPath = path.join(process.env.APPDATA || '', 'npm');
      env.PATH = `${npmGlobalPath};${env.PATH || ''}`;
    } else {
      const importantVars = ['HOME', 'USER', 'SHELL'];
      for (const key of importantVars) {
        if (process.env[key]) {
          env[key] = process.env[key]!;
        }
      }
      env.TERM = 'xterm-256color';
      env.HOME = homeDir;

      const nodePaths = [
        path.join(homeDir, '.nvm', 'current', 'bin'),
        path.join(homeDir, '.fnm', 'current', 'bin'),
        path.join(homeDir, '.volta', 'bin'),
        path.join(homeDir, '.local', 'bin'),
        path.join(homeDir, '.cargo', 'bin'),
      ].filter(p => fs.existsSync(p));

      const basePath = '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin';
      env.PATH = nodePaths.length > 0 ? `${nodePaths.join(':')}:${basePath}` : basePath;

      env.LANG = 'ko_KR.UTF-8';
      env.LC_ALL = 'ko_KR.UTF-8';
      env.LC_CTYPE = 'UTF-8';
    }

    console.log(`[PtyPool] Spawning PTY for pane ${paneId} in ${workDir}`);

    const proc = pty.spawn(shell, shellArgs, {
      name: 'xterm-256color',
      cols: 120,
      rows: 30,
      cwd: workDir,
      env,
      useConpty: isWindows,
    });

    const entry: PtyEntry = {
      process: proc,
      dataCallbacks: [],
      exitCallbacks: [],
    };

    this.pool.set(paneId, entry);

    // 데이터 핸들러
    proc.onData((data: string) => {
      entry.dataCallbacks.forEach(cb => cb(data));
    });

    // 종료 핸들러
    proc.onExit(({ exitCode }) => {
      console.log(`[PtyPool] PTY ${paneId} exited with code:`, exitCode);
      entry.exitCallbacks.forEach(cb => cb(exitCode));
      this.pool.delete(paneId);
    });

    console.log(`[PtyPool] PTY ${paneId} spawned with PID:`, proc.pid);
    return proc.pid;
  }

  /**
   * 특정 paneId의 PTY에 데이터 전송
   */
  write(paneId: string, data: string): void {
    const entry = this.pool.get(paneId);
    if (!entry) throw new Error(`PTY not found for pane: ${paneId}`);
    entry.process.write(data);
  }

  /**
   * 명령어 전송 (텍스트 + Enter)
   */
  async writeCommand(paneId: string, text: string): Promise<void> {
    const entry = this.pool.get(paneId);
    if (!entry) throw new Error(`PTY not found for pane: ${paneId}`);

    const clean = text.trim();
    if (!clean) return;

    entry.process.write(clean + '\r');
  }

  /**
   * 터미널 크기 조정
   */
  resize(paneId: string, cols: number, rows: number): void {
    const entry = this.pool.get(paneId);
    if (!entry) return;
    entry.process.resize(cols, rows);
  }

  /**
   * 특정 paneId의 PTY 종료
   */
  kill(paneId: string): void {
    const entry = this.pool.get(paneId);
    if (!entry) return;
    entry.process.kill();
    this.pool.delete(paneId);
  }

  /**
   * 모든 PTY 종료
   */
  killAll(): void {
    for (const [paneId, entry] of this.pool) {
      try {
        entry.process.kill();
      } catch (e) {
        console.error(`[PtyPool] Error killing PTY ${paneId}:`, e);
      }
    }
    this.pool.clear();
  }

  /**
   * 데이터 수신 콜백 등록
   */
  onData(paneId: string, callback: (data: string) => void): void {
    const entry = this.pool.get(paneId);
    if (!entry) return;
    entry.dataCallbacks.push(callback);
  }

  /**
   * 종료 콜백 등록
   */
  onExit(paneId: string, callback: (exitCode: number) => void): void {
    const entry = this.pool.get(paneId);
    if (!entry) return;
    entry.exitCallbacks.push(callback);
  }

  /**
   * 실행 여부 확인
   */
  isRunning(paneId: string): boolean {
    return this.pool.has(paneId);
  }

  /**
   * 하나라도 실행 중인지 확인
   */
  hasAnyRunning(): boolean {
    return this.pool.size > 0;
  }

  /**
   * 실행 중인 paneId 목록
   */
  getRunningPaneIds(): string[] {
    return Array.from(this.pool.keys());
  }
}
