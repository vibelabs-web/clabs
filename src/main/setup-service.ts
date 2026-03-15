import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { app, shell } from 'electron';
import { exec, execSync } from 'child_process';
import { promisify } from 'util';
import log from 'electron-log';

const execAsync = promisify(exec);

/**
 * SetupService - Handles first-launch setup and skill installation
 *
 * Responsibilities:
 * - Check if first launch
 * - Copy skills from app resources to ~/.claude/
 * - Set up MCP configurations
 * - Check Claude CLI availability
 */
export class SetupService {
  private configPath: string;
  private claudeDir: string;
  private resourcesPath: string;

  constructor() {
    this.claudeDir = path.join(os.homedir(), '.claude');
    this.configPath = path.join(this.claudeDir, '.clabs-installed');

    // Get resources path - different in dev vs production
    if (app.isPackaged) {
      // Production: resources are in app.asar.unpacked or extraResources
      this.resourcesPath = path.join(process.resourcesPath, 'skillpack');
    } else {
      // Development: resources are in project directory
      this.resourcesPath = path.join(__dirname, '..', '..', '..', 'resources', 'skillpack');
    }

    log.info('SetupService initialized');
    log.info('Claude dir:', this.claudeDir);
    log.info('Resources path:', this.resourcesPath);
  }

  /**
   * Check if this is the first launch
   */
  isFirstLaunch(): boolean {
    return !fs.existsSync(this.configPath);
  }

  /**
   * Get installed version from config
   */
  getInstalledVersion(): string | null {
    try {
      if (fs.existsSync(this.configPath)) {
        const content = fs.readFileSync(this.configPath, 'utf-8');
        const config = JSON.parse(content);
        return config.version || null;
      }
    } catch (error) {
      log.error('Failed to read installed version:', error);
    }
    return null;
  }

  /**
   * Get current app version
   */
  getCurrentVersion(): string {
    return app.getVersion();
  }

  /**
   * Check if upgrade is needed
   */
  needsUpgrade(): boolean {
    const installed = this.getInstalledVersion();
    const current = this.getCurrentVersion();

    if (!installed) return true;
    return installed !== current;
  }

  /**
   * Run initial setup
   * @returns Setup result with success status and message
   */
  async runSetup(): Promise<{ success: boolean; message: string; details?: string[] }> {
    const details: string[] = [];

    try {
      log.info('Starting setup process...');

      // 1. Create .claude directory structure
      this.createDirectoryStructure();
      details.push('.claude 디렉토리 구조 생성 완료');

      // 2. Copy skills from resources
      const skillsCopied = await this.copySkills();
      details.push(`스킬 ${skillsCopied}개 설치 완료`);

      // 3. Copy agents
      const agentsCopied = await this.copyAgents();
      details.push(`에이전트 ${agentsCopied}개 설치 완료`);

      // 4. Copy commands
      const commandsCopied = await this.copyCommands();
      details.push(`커맨드 ${commandsCopied}개 설치 완료`);

      // 5. Copy constitutions
      const constitutionsCopied = await this.copyConstitutions();
      details.push(`헌법 ${constitutionsCopied}개 설치 완료`);

      // 6. Copy docs
      await this.copyDocs();
      details.push('문서 설치 완료');

      // 7. Copy settings template (if not exists)
      await this.copySettingsTemplate();
      details.push('설정 템플릿 확인 완료');

      // 8. Save installation marker
      this.saveInstallationMarker();
      details.push('설치 마커 저장 완료');

      log.info('Setup completed successfully');
      return {
        success: true,
        message: 'Claude Labs 스킬팩이 성공적으로 설치되었습니다!',
        details
      };
    } catch (error) {
      log.error('Setup failed:', error);
      return {
        success: false,
        message: `설치 중 오류가 발생했습니다: ${error}`,
        details
      };
    }
  }

  /**
   * Create .claude directory structure
   */
  private createDirectoryStructure(): void {
    const dirs = [
      this.claudeDir,
      path.join(this.claudeDir, 'skills'),
      path.join(this.claudeDir, 'agents'),
      path.join(this.claudeDir, 'commands'),
      path.join(this.claudeDir, 'constitutions'),
      path.join(this.claudeDir, 'docs'),
      path.join(this.claudeDir, 'memory'),
      path.join(this.claudeDir, 'goals'),
      path.join(this.claudeDir, 'metrics')
    ];

    for (const dir of dirs) {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        log.info('Created directory:', dir);
      }
    }
  }

  /**
   * Copy skills from resources to user directory
   * @returns Number of skills copied
   */
  private async copySkills(): Promise<number> {
    const srcDir = path.join(this.resourcesPath, 'skills');
    const destDir = path.join(this.claudeDir, 'skills');

    if (!fs.existsSync(srcDir)) {
      log.warn('Skills source directory not found:', srcDir);
      return 0;
    }

    return this.copyDirectoryRecursive(srcDir, destDir);
  }

  /**
   * Copy agents from resources to user directory
   * @returns Number of agents copied
   */
  private async copyAgents(): Promise<number> {
    const srcDir = path.join(this.resourcesPath, 'agents');
    const destDir = path.join(this.claudeDir, 'agents');

    if (!fs.existsSync(srcDir)) {
      log.warn('Agents source directory not found:', srcDir);
      return 0;
    }

    return this.copyFilesInDirectory(srcDir, destDir);
  }

  /**
   * Copy commands from resources to user directory
   * @returns Number of commands copied
   */
  private async copyCommands(): Promise<number> {
    const srcDir = path.join(this.resourcesPath, 'commands');
    const destDir = path.join(this.claudeDir, 'commands');

    if (!fs.existsSync(srcDir)) {
      log.warn('Commands source directory not found:', srcDir);
      return 0;
    }

    return this.copyFilesInDirectory(srcDir, destDir);
  }

  /**
   * Copy constitutions from resources to user directory
   * @returns Number of constitution files copied
   */
  private async copyConstitutions(): Promise<number> {
    const srcDir = path.join(this.resourcesPath, 'constitutions');
    const destDir = path.join(this.claudeDir, 'constitutions');

    if (!fs.existsSync(srcDir)) {
      log.warn('Constitutions source directory not found:', srcDir);
      return 0;
    }

    return this.copyDirectoryRecursive(srcDir, destDir);
  }

  /**
   * Copy docs from resources to user directory
   */
  private async copyDocs(): Promise<void> {
    const srcDir = path.join(this.resourcesPath, 'docs');
    const destDir = path.join(this.claudeDir, 'docs');

    if (!fs.existsSync(srcDir)) {
      log.warn('Docs source directory not found:', srcDir);
      return;
    }

    this.copyFilesInDirectory(srcDir, destDir);
  }

  /**
   * Copy settings template if user doesn't have settings.json
   */
  private async copySettingsTemplate(): Promise<void> {
    const srcFile = path.join(this.resourcesPath, 'settings.json');
    const destFile = path.join(this.claudeDir, 'settings.json');

    // Only copy if destination doesn't exist (preserve user settings)
    if (!fs.existsSync(destFile) && fs.existsSync(srcFile)) {
      fs.copyFileSync(srcFile, destFile);
      log.info('Copied settings template');
    }
  }

  /**
   * Copy all files in a directory (non-recursive)
   * @returns Number of files copied
   */
  private copyFilesInDirectory(srcDir: string, destDir: string): number {
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }

    let count = 0;
    const entries = fs.readdirSync(srcDir);

    for (const entry of entries) {
      const srcPath = path.join(srcDir, entry);
      const destPath = path.join(destDir, entry);
      const stat = fs.statSync(srcPath);

      if (stat.isFile()) {
        fs.copyFileSync(srcPath, destPath);
        count++;
      }
    }

    return count;
  }

  /**
   * Copy directory recursively
   * @returns Number of items copied
   */
  private copyDirectoryRecursive(srcDir: string, destDir: string): number {
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }

    let count = 0;
    const entries = fs.readdirSync(srcDir);

    for (const entry of entries) {
      const srcPath = path.join(srcDir, entry);
      const destPath = path.join(destDir, entry);
      const stat = fs.statSync(srcPath);

      if (stat.isDirectory()) {
        // For skills, each directory is one skill
        if (srcDir.includes('skills') && !srcPath.includes('references') && !srcPath.includes('scripts') && !srcPath.includes('templates') && !srcPath.includes('hooks') && !srcPath.includes('assets')) {
          count++;
        }
        this.copyDirectoryRecursive(srcPath, destPath);
      } else {
        fs.copyFileSync(srcPath, destPath);
        // For constitutions, count individual files
        if (srcDir.includes('constitutions') && entry.endsWith('.md')) {
          count++;
        }
      }
    }

    return count;
  }

  /**
   * Save installation marker
   */
  private saveInstallationMarker(): void {
    const config = {
      version: this.getCurrentVersion(),
      installedAt: new Date().toISOString(),
      platform: process.platform
    };

    fs.writeFileSync(this.configPath, JSON.stringify(config, null, 2));
    log.info('Installation marker saved');
  }

  /**
   * Check if Claude CLI is available
   * @returns true if claude command is found
   */
  async checkClaudeCli(): Promise<boolean> {
    const homeDir = os.homedir();

    // GUI 앱에서는 터미널과 다른 PATH를 가지므로 직접 경로 확인
    if (process.platform === 'win32') {
      // Windows: 일반적인 설치 경로들 확인
      const windowsPaths = [
        path.join(homeDir, 'AppData', 'Roaming', 'npm', 'claude.cmd'),
        path.join(homeDir, 'AppData', 'Roaming', 'npm', 'claude'),
        'C:\\Program Files\\nodejs\\claude.cmd',
      ];

      // nvm-windows 경로 추가
      const nvmDir = process.env.NVM_HOME || path.join(homeDir, 'AppData', 'Roaming', 'nvm');
      if (fs.existsSync(nvmDir)) {
        try {
          const versions = fs.readdirSync(nvmDir).filter(v => v.startsWith('v'));
          for (const ver of versions) {
            windowsPaths.push(path.join(nvmDir, ver, 'claude.cmd'));
            windowsPaths.push(path.join(nvmDir, ver, 'claude'));
          }
        } catch { /* ignore */ }
      }

      for (const p of windowsPaths) {
        if (fs.existsSync(p)) {
          log.info('Found Claude CLI at:', p);
          return true;
        }
      }
    } else {
      // macOS/Linux: 일반적인 설치 경로들 확인
      const unixPaths = [
        '/usr/local/bin/claude',                          // npm global (Intel Mac)
        '/opt/homebrew/bin/claude',                       // Homebrew (Apple Silicon)
        path.join(homeDir, '.npm-global', 'bin', 'claude'),  // npm global custom
        path.join(homeDir, '.local', 'bin', 'claude'),       // pip/user local
        '/usr/bin/claude',                                // system
      ];

      // nvm 경로 추가 (가장 흔한 케이스)
      const nvmDir = path.join(homeDir, '.nvm', 'versions', 'node');
      if (fs.existsSync(nvmDir)) {
        try {
          const versions = fs.readdirSync(nvmDir);
          for (const ver of versions) {
            unixPaths.push(path.join(nvmDir, ver, 'bin', 'claude'));
          }
        } catch { /* ignore */ }
      }

      // fnm 경로 추가
      const fnmDir = path.join(homeDir, '.fnm', 'node-versions');
      if (fs.existsSync(fnmDir)) {
        try {
          const versions = fs.readdirSync(fnmDir);
          for (const ver of versions) {
            unixPaths.push(path.join(fnmDir, ver, 'installation', 'bin', 'claude'));
          }
        } catch { /* ignore */ }
      }

      // volta 경로 추가
      const voltaBin = path.join(homeDir, '.volta', 'bin', 'claude');
      unixPaths.push(voltaBin);

      // asdf 경로 추가
      const asdfDir = path.join(homeDir, '.asdf', 'shims');
      unixPaths.push(path.join(asdfDir, 'claude'));

      for (const p of unixPaths) {
        if (fs.existsSync(p)) {
          log.info('Found Claude CLI at:', p);
          return true;
        }
      }
    }

    // Fallback: shell을 통해 which/where 실행 (PATH 포함)
    try {
      if (process.platform === 'win32') {
        await execAsync('where claude');
      } else {
        // 사용자의 shell 설정을 로드하여 PATH 확인
        const shell = process.env.SHELL || '/bin/zsh';
        await execAsync(`${shell} -l -c "which claude"`);
      }
      return true;
    } catch {
      log.warn('Claude CLI not found in PATH');
      return false;
    }
  }

  /**
   * Get Claude CLI installation instructions
   */
  getClaudeCliInstructions(): string {
    if (process.platform === 'win32') {
      return `Claude Code CLI를 설치하려면 PowerShell에서 다음 명령을 실행하세요:

npm install -g @anthropic-ai/claude-code

설치 후 터미널을 재시작해주세요.`;
    } else if (process.platform === 'darwin') {
      return `Claude Code CLI를 설치하려면 터미널에서 다음 명령을 실행하세요:

npm install -g @anthropic-ai/claude-code

또는 Homebrew를 사용할 수 있습니다:

brew install claude-code`;
    } else {
      return `Claude Code CLI를 설치하려면 터미널에서 다음 명령을 실행하세요:

npm install -g @anthropic-ai/claude-code`;
    }
  }

  /**
   * Get setup status summary
   */
  getSetupStatus(): {
    isSetup: boolean;
    version: string | null;
    skillsDir: string;
    hasSkills: boolean;
    skillCount: number;
  } {
    const skillsDir = path.join(this.claudeDir, 'skills');
    let hasSkills = false;
    let skillCount = 0;

    if (fs.existsSync(skillsDir)) {
      try {
        const entries = fs.readdirSync(skillsDir);
        skillCount = entries.filter(e => {
          const stat = fs.statSync(path.join(skillsDir, e));
          return stat.isDirectory();
        }).length;
        hasSkills = skillCount > 0;
      } catch {
        // Ignore errors
      }
    }

    return {
      isSetup: !this.isFirstLaunch(),
      version: this.getInstalledVersion(),
      skillsDir,
      hasSkills,
      skillCount
    };
  }

  // ─────────────────────────────────────────────────────────────
  // MCP Server Setup
  // ─────────────────────────────────────────────────────────────

  /**
   * Get MCP status for all servers
   */
  async getMcpStatus(): Promise<{
    gemini: 'configured' | 'not_configured' | 'error';
    stitch: 'configured' | 'not_configured' | 'error';
    context7: 'configured' | 'not_configured' | 'error';
    github: 'configured' | 'not_configured' | 'error';
  }> {
    type McpStatusValue = 'configured' | 'not_configured' | 'error';
    const status: {
      gemini: McpStatusValue;
      stitch: McpStatusValue;
      context7: McpStatusValue;
      github: McpStatusValue;
    } = {
      gemini: 'not_configured',
      stitch: 'not_configured',
      context7: 'not_configured',
      github: 'not_configured'
    };

    try {
      // Check settings.local.json for enabled MCP servers
      const localSettingsPath = path.join(this.claudeDir, 'settings.local.json');
      if (fs.existsSync(localSettingsPath)) {
        const content = fs.readFileSync(localSettingsPath, 'utf-8');
        const settings = JSON.parse(content);

        if (settings.enabledMcpjsonServers) {
          if (settings.enabledMcpjsonServers.includes('gemini')) {
            status.gemini = 'configured';
          }
          if (settings.enabledMcpjsonServers.includes('stitch')) {
            status.stitch = 'configured';
          }
          if (settings.enabledMcpjsonServers.includes('context7')) {
            status.context7 = 'configured';
          }
          if (settings.enabledMcpjsonServers.includes('github')) {
            status.github = 'configured';
          }
        }
      }

      // Also check ~/.claude.json (claude mcp add-json writes here)
      const claudeJsonPath = path.join(os.homedir(), '.claude.json');
      if (fs.existsSync(claudeJsonPath)) {
        const content = fs.readFileSync(claudeJsonPath, 'utf-8');
        const claudeConfig = JSON.parse(content);

        if (claudeConfig.mcpServers) {
          if (claudeConfig.mcpServers.gemini) status.gemini = 'configured';
          if (claudeConfig.mcpServers.stitch) status.stitch = 'configured';
          if (claudeConfig.mcpServers.context7) status.context7 = 'configured';
          if (claudeConfig.mcpServers.github) status.github = 'configured';
        }
      }
    } catch (error) {
      log.error('Error checking MCP status:', error);
    }

    return status;
  }

  /**
   * Setup Context7 MCP (가장 간단 - npx만 있으면 됨)
   */
  async setupContext7Mcp(): Promise<{ success: boolean; message: string }> {
    try {
      log.info('Setting up Context7 MCP...');

      // Check if npx is available
      try {
        await execAsync('npx --version');
      } catch {
        return { success: false, message: 'npx가 설치되어 있지 않습니다. Node.js를 설치해주세요.' };
      }

      // Register via claude mcp add-json
      const mcpConfig = JSON.stringify({
        command: 'npx',
        args: ['-y', '@anthropic-ai/mcp-server-context7']
      });

      try {
        await execAsync(`claude mcp remove --scope user context7`).catch(() => {});
        await execAsync(`claude mcp add-json --scope user context7 '${mcpConfig}'`);
        log.info('Context7 MCP registered successfully');
        return { success: true, message: 'Context7 MCP가 설정되었습니다.' };
      } catch (error) {
        // Fallback: directly write to settings
        await this.addMcpToSettings('context7', { command: 'npx', args: ['-y', '@anthropic-ai/mcp-server-context7'] });
        return { success: true, message: 'Context7 MCP가 설정되었습니다. (fallback)' };
      }
    } catch (error) {
      log.error('Context7 MCP setup failed:', error);
      return { success: false, message: `설정 실패: ${error}` };
    }
  }

  /**
   * Setup Stitch MCP
   */
  async setupStitchMcp(gcpProjectId: string, apiKey?: string): Promise<{ success: boolean; message: string }> {
    try {
      log.info('Setting up Stitch MCP...');

      if (!gcpProjectId) {
        return { success: false, message: 'GCP 프로젝트 ID가 필요합니다.' };
      }

      const env: Record<string, string> = {
        GOOGLE_CLOUD_PROJECT: gcpProjectId
      };

      if (apiKey) {
        env.STITCH_API_KEY = apiKey;
      }

      const mcpConfig = {
        command: 'npx',
        args: ['-y', 'stitch-mcp'],
        env
      };

      try {
        await execAsync(`claude mcp remove --scope user stitch`).catch(() => {});
        await execAsync(`claude mcp add-json --scope user stitch '${JSON.stringify(mcpConfig)}'`);
        log.info('Stitch MCP registered successfully');
        return { success: true, message: 'Stitch MCP가 설정되었습니다.' };
      } catch (error) {
        await this.addMcpToSettings('stitch', mcpConfig);
        return { success: true, message: 'Stitch MCP가 설정되었습니다. (fallback)' };
      }
    } catch (error) {
      log.error('Stitch MCP setup failed:', error);
      return { success: false, message: `설정 실패: ${error}` };
    }
  }

  /**
   * Setup Gemini MCP (OAuth 방식)
   */
  async setupGeminiMcp(): Promise<{ success: boolean; message: string; needsAuth?: boolean }> {
    try {
      log.info('Setting up Gemini MCP...');

      // Check if gemini CLI is installed
      let geminiInstalled = false;
      try {
        await execAsync('gemini --version');
        geminiInstalled = true;
      } catch {
        // Try to install gemini CLI
        try {
          log.info('Installing gemini CLI...');
          await execAsync('npm install -g @google/gemini-cli');
          geminiInstalled = true;
        } catch (installError) {
          return {
            success: false,
            message: 'gemini CLI 설치에 실패했습니다. npm install -g @google/gemini-cli 를 수동으로 실행해주세요.'
          };
        }
      }

      // Check if gemini-mcp exists in resources
      const mcpDir = path.join(os.homedir(), '.claude', 'mcp-servers', 'gemini-mcp');
      const sourceMcpDir = path.join(this.resourcesPath, '..', '..', 'mcp-servers', 'gemini-mcp');

      if (fs.existsSync(sourceMcpDir)) {
        // Copy gemini-mcp from resources
        if (!fs.existsSync(path.dirname(mcpDir))) {
          fs.mkdirSync(path.dirname(mcpDir), { recursive: true });
        }
        this.copyDirectoryRecursive(sourceMcpDir, mcpDir);
        log.info('Gemini MCP files copied');
      }

      // Register MCP
      const mcpConfig = {
        command: 'node',
        args: [path.join(mcpDir, 'index.js')]
      };

      try {
        await execAsync(`claude mcp remove --scope user gemini`).catch(() => {});
        await execAsync(`claude mcp add-json --scope user gemini '${JSON.stringify(mcpConfig)}'`);
        log.info('Gemini MCP registered successfully');
      } catch (error) {
        await this.addMcpToSettings('gemini', mcpConfig);
      }

      return {
        success: true,
        message: 'Gemini MCP가 설정되었습니다. OAuth 인증이 필요합니다.',
        needsAuth: true
      };
    } catch (error) {
      log.error('Gemini MCP setup failed:', error);
      return { success: false, message: `설정 실패: ${error}` };
    }
  }

  /**
   * Setup GitHub MCP
   */
  async setupGithubMcp(token: string): Promise<{ success: boolean; message: string }> {
    try {
      log.info('Setting up GitHub MCP...');

      if (!token) {
        return { success: false, message: 'GitHub Personal Access Token이 필요합니다.' };
      }

      const mcpConfig = {
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-github'],
        env: {
          GITHUB_PERSONAL_ACCESS_TOKEN: token
        }
      };

      try {
        await execAsync(`claude mcp remove --scope user github`).catch(() => {});
        await execAsync(`claude mcp add-json --scope user github '${JSON.stringify(mcpConfig)}'`);
        log.info('GitHub MCP registered successfully');
        return { success: true, message: 'GitHub MCP가 설정되었습니다.' };
      } catch (error) {
        await this.addMcpToSettings('github', mcpConfig);
        return { success: true, message: 'GitHub MCP가 설정되었습니다. (fallback)' };
      }
    } catch (error) {
      log.error('GitHub MCP setup failed:', error);
      return { success: false, message: `설정 실패: ${error}` };
    }
  }

  /**
   * Add MCP server to settings.local.json (fallback method)
   */
  private async addMcpToSettings(name: string, config: any): Promise<void> {
    const settingsPath = path.join(this.claudeDir, 'settings.local.json');
    let settings: any = {};

    if (fs.existsSync(settingsPath)) {
      const content = fs.readFileSync(settingsPath, 'utf-8');
      settings = JSON.parse(content);
    }

    // Add to mcpServers
    if (!settings.mcpServers) {
      settings.mcpServers = {};
    }
    settings.mcpServers[name] = config;

    // Add to enabledMcpjsonServers
    if (!settings.enabledMcpjsonServers) {
      settings.enabledMcpjsonServers = [];
    }
    if (!settings.enabledMcpjsonServers.includes(name)) {
      settings.enabledMcpjsonServers.push(name);
    }

    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
    log.info(`Added ${name} to settings.local.json`);
  }

  /**
   * Setup Slack webhook
   */
  async setupSlackWebhook(webhookUrl: string): Promise<{ success: boolean; message: string }> {
    try {
      if (!webhookUrl || !webhookUrl.startsWith('https://hooks.slack.com/')) {
        return { success: false, message: '유효한 Slack Webhook URL이 아닙니다.' };
      }

      const settingsPath = path.join(this.claudeDir, 'settings.json');
      let settings: any = {};

      if (fs.existsSync(settingsPath)) {
        const content = fs.readFileSync(settingsPath, 'utf-8');
        settings = JSON.parse(content);
      }

      settings.slack_webhook = webhookUrl;
      fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));

      log.info('Slack webhook configured');
      return { success: true, message: 'Slack 웹훅이 설정되었습니다.' };
    } catch (error) {
      log.error('Slack webhook setup failed:', error);
      return { success: false, message: `설정 실패: ${error}` };
    }
  }

  /**
   * Open OAuth URL in browser
   */
  async openOAuthUrl(service: 'google' | 'github'): Promise<void> {
    if (service === 'google') {
      // gcloud auth application-default login opens browser automatically
      shell.openExternal('https://console.cloud.google.com');
    } else if (service === 'github') {
      shell.openExternal('https://github.com/settings/tokens?type=beta');
    }
  }

  /**
   * Run gcloud auth (opens browser)
   */
  async runGcloudAuth(): Promise<{ success: boolean; message: string }> {
    try {
      // Check if gcloud is installed
      try {
        await execAsync('gcloud --version');
      } catch {
        return {
          success: false,
          message: 'gcloud CLI가 설치되어 있지 않습니다. https://cloud.google.com/sdk/docs/install 에서 설치해주세요.'
        };
      }

      // Run gcloud auth (this will open browser)
      log.info('Starting gcloud auth...');
      exec('gcloud auth application-default login');

      return {
        success: true,
        message: '브라우저에서 Google 계정으로 로그인해주세요.'
      };
    } catch (error) {
      log.error('gcloud auth failed:', error);
      return { success: false, message: `인증 실패: ${error}` };
    }
  }

  /**
   * Check if gcloud is authenticated
   */
  async checkGcloudAuth(): Promise<boolean> {
    try {
      const { stdout } = await execAsync('gcloud auth list --filter=status:ACTIVE --format="value(account)"');
      return stdout.trim().length > 0;
    } catch {
      return false;
    }
  }
}

// Singleton instance
let setupService: SetupService | null = null;

/**
 * Get the setup service instance
 */
export function getSetupService(): SetupService {
  if (!setupService) {
    setupService = new SetupService();
  }
  return setupService;
}
