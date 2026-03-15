import * as pty from 'node-pty';
import * as os from 'os';
import * as path from 'path';

/**
 * PtyManager - Manages Claude Code CLI process via node-pty
 *
 * Responsibilities:
 * - Spawn interactive shell with Claude Code CLI
 * - Send input to the process
 * - Receive output from the process
 * - Manage process lifecycle (start/stop)
 */
export class PtyManager {
  private process: pty.IPty | null = null;
  private dataCallbacks: Array<(data: string) => void> = [];
  private exitCallbacks: Array<(exitCode: number) => void> = [];

  // Windows에서 claude를 직접 실행하는지 여부
  private directClaudeMode: boolean = false;

  // 사용 중인 셸 타입 (powershell, cmd, unix)
  private shellType: 'powershell' | 'cmd' | 'unix' = 'unix';

  /**
   * Spawn interactive shell
   * @param cwd Working directory (defaults to home directory)
   * @returns Process ID
   */
  spawn(cwd?: string): number {
    // 이미 실행 중이면 먼저 종료 (핸들러에서 이미 처리하지만 안전장치)
    if (this.process) {
      console.log('PTY already running, killing existing process first');
      this.kill();
    }

    const homeDir = os.homedir();
    const workDir = cwd && cwd !== '~' ? cwd : homeDir;

    // OS별 셸 설정
    const isWindows = process.platform === 'win32';
    let shell: string;
    let shellArgs: string[] = [];

    if (isWindows) {
      // Windows: PowerShell 사용 (Windows Console API 100% 준수)
      // Git Bash(MinGW)는 Unix 파이프 에뮬레이션으로 Claude Code의
      // Raw Mode Console Input과 호환성 문제 발생 (Impedance Mismatch)
      shell = 'powershell.exe';
      shellArgs = ['-NoLogo', '-NoProfile'];
      this.shellType = 'powershell';
      this.directClaudeMode = false;
    } else if (process.platform === 'darwin') {
      shell = '/bin/zsh';
      shellArgs = [];
      this.shellType = 'unix';
      this.directClaudeMode = false;
    } else {
      shell = '/bin/bash';
      shellArgs = [];
      this.directClaudeMode = false;
      this.shellType = 'unix';
    }

    // 환경변수 설정
    const env: { [key: string]: string } = {};

    if (isWindows) {
      // Windows: 호스트 OS 환경변수 전체 복사 (누락 방지)
      for (const [key, value] of Object.entries(process.env)) {
        if (value !== undefined) env[key] = value;
      }
      env.TERM = 'xterm-256color';

      // npm global 경로를 PATH 선두에 추가
      const npmGlobalPath = path.join(process.env.APPDATA || '', 'npm');
      env.PATH = `${npmGlobalPath};${env.PATH || ''}`;
    } else {
      // macOS/Linux
      const importantVars = ['HOME', 'USER', 'SHELL'];
      for (const key of importantVars) {
        if (process.env[key]) {
          env[key] = process.env[key]!;
        }
      }
      env.TERM = 'xterm-256color';
      env.HOME = homeDir;

      // nvm/fnm/volta 등 Node 버전 매니저 경로 포함
      const nodePaths = [
        path.join(homeDir, '.nvm', 'current', 'bin'), // nvm symlink
        path.join(homeDir, '.fnm', 'current', 'bin'), // fnm symlink
        path.join(homeDir, '.volta', 'bin'),          // volta
        path.join(homeDir, '.local', 'bin'),          // pip/pipx
        path.join(homeDir, '.cargo', 'bin'),          // rust
      ].filter(p => require('fs').existsSync(p));

      const basePath = '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin';
      env.PATH = nodePaths.length > 0 ? `${nodePaths.join(':')}:${basePath}` : basePath;

      // 로케일 설정 (CJK 문자 지원)
      env.LANG = 'ko_KR.UTF-8';
      env.LC_ALL = 'ko_KR.UTF-8';
      env.LC_CTYPE = 'UTF-8';
    }

    console.log('Spawning shell:', shell, 'args:', shellArgs, 'cwd:', workDir, 'directClaudeMode:', this.directClaudeMode);

    this.process = pty.spawn(shell, shellArgs, {
      name: 'xterm-256color',
      cols: 120,
      rows: 30,
      cwd: workDir,
      env,
      // ConPTY 사용 (PowerShell/cmd.exe는 Windows Console API 네이티브 호환)
      // Git Bash(MinGW)에서만 ConPTY 호환성 문제 발생 → PowerShell로 전환하여 해결
      useConpty: isWindows,
    });

    console.log('PTY spawned with PID:', this.process.pid);

    // Set up data handler
    this.process.onData((data: string) => {
      this.dataCallbacks.forEach((callback) => callback(data));
    });

    // Set up exit handler
    this.process.onExit(({ exitCode }) => {
      console.log('PTY process exited with code:', exitCode);
      // Exit 콜백 호출 (cleanup 전에 호출해야 콜백이 남아있음)
      this.exitCallbacks.forEach((callback) => callback(exitCode));
      this.cleanup();
    });

    return this.process.pid;
  }

  /**
   * Start Claude Code CLI in the current shell
   */
  startClaude(): void {
    if (!this.process) {
      throw new Error('Process not running');
    }

    // Windows에서는 자동 실행 비활성화 (블로킹 문제)
    // 사용자가 터미널에서 직접 'claude --dangerously-skip-permissions' 입력해야 함
    if (process.platform === 'win32') {
      console.log('Windows: Claude auto-start disabled. User should type "claude --dangerously-skip-permissions" manually.');
      return;
    }

    // Windows에서 직접 claude를 spawn한 경우 이미 실행 중이므로 skip
    if (this.directClaudeMode) {
      console.log('Claude already running in direct mode');
      return;
    }

    // macOS/Linux: 셸에서 claude 명령어 실행
    console.log('Sending claude command to PTY');
    this.process.write('claude --dangerously-skip-permissions\r');
  }

  /**
   * Write raw input to the pty process (키보드 입력용)
   * @param data Input string to send
   * @throws Error if process is not running
   */
  write(data: string): void {
    if (!this.process) {
      throw new Error('Process not running');
    }

    console.log('PTY write:', JSON.stringify(data));
    this.process.write(data);
  }

  /**
   * Write a command to the pty process.
   * PowerShell/cmd.exe: 네이티브 Windows Console API 호환 → 직접 전송
   * Unix: 셸이 직접 처리 → 직접 전송
   * @param text Command text (without line ending)
   */
  async writeCommand(text: string): Promise<void> {
    if (!this.process) {
      throw new Error('Process not running');
    }

    const clean = text.trim();
    if (!clean) return;

    console.log('PTY writeCommand:', JSON.stringify(clean));

    // 텍스트 전송 후 Enter(\r) — PowerShell/cmd/zsh/bash 모두 \r로 충분
    this.process.write(clean + '\r');
    console.log('PTY writeCommand: sent text + \\r');
  }

  /**
   * Register callback for process output
   * @param callback Function to call when data is received
   */
  onData(callback: (data: string) => void): void {
    this.dataCallbacks.push(callback);
  }

  /**
   * Register callback for process exit
   * @param callback Function to call when process exits
   */
  onExit(callback: (exitCode: number) => void): void {
    this.exitCallbacks.push(callback);
  }

  /**
   * Kill the pty process
   */
  kill(): void {
    if (!this.process) {
      return;
    }

    this.process.kill();
    this.cleanup();
  }

  /**
   * Check if process is running
   * @returns true if process is active
   */
  isRunning(): boolean {
    return this.process !== null;
  }

  /**
   * Resize the pty terminal
   * @param cols Number of columns
   * @param rows Number of rows
   */
  resize(cols: number, rows: number): void {
    if (!this.process) {
      return;
    }

    this.process.resize(cols, rows);
  }

  /**
   * Clean up process and callbacks
   */
  private cleanup(): void {
    this.process = null;
    this.dataCallbacks = [];
    this.exitCallbacks = [];
    this.directClaudeMode = false;
    this.shellType = process.platform === 'win32' ? 'powershell' : 'unix';
  }
}
