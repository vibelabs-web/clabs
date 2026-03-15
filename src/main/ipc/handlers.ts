// @TASK P0-IPC - Main 프로세스 IPC 핸들러
// @SPEC clabs 긴급 보완 작업

import { ipcMain, dialog, app, BrowserWindow } from 'electron';
import { getAppConfig } from '../stores/config-store';
import { LicenseStore } from '../stores/license-store';
import { PtyManager } from '../pty-manager';
import { PtyPoolManager } from '../pty-pool-manager';
import { getSkillScanner, SkillInfo } from '../skill-scanner';
import { getAppUsage } from '../stores/usage-store';
import { getSessionWatcher } from '../session-watcher';
import { getUsageData } from '../usage-api';
import Store from 'electron-store';
import type {
  Config,
  License,
  LicenseValidationResult,
  Project,
  UpdateInfo
} from '@shared/types';
import path from 'path';
import fs from 'fs';
import os from 'os';

// ─────────────────────────────────────────────────────────────
// PTY 인스턴스
// ─────────────────────────────────────────────────────────────

const ptyManager = new PtyManager();
const ptyPool = new PtyPoolManager();

// ─────────────────────────────────────────────────────────────
// 스토어 인스턴스
// ─────────────────────────────────────────────────────────────

const configStore = getAppConfig();
const licenseStore = new LicenseStore();
const usageStore = getAppUsage();
const sessionWatcher = getSessionWatcher();
const projectsStore = new Store<{ projects: Project[] }>({
  name: 'projects',
  defaults: { projects: [] }
});

// ─────────────────────────────────────────────────────────────
// PTY 핸들러
// ─────────────────────────────────────────────────────────────

ipcMain.handle('pty:spawn', async (_event, command: string, cwd: string, paneId?: string) => {
  try {
    const targetPaneId = paneId || 'pane-default';

    // 경로 해석: "." → process.cwd(), "~" → os.homedir()
    let resolvedCwd = cwd;
    if (cwd === '.') {
      resolvedCwd = process.cwd();
    } else if (cwd === '~' || cwd.startsWith('~/')) {
      resolvedCwd = cwd.replace(/^~/, os.homedir());
    }

    console.log(`PTY starting for pane ${targetPaneId} in directory:`, resolvedCwd);

    // 이미 해당 paneId에 PTY가 실행 중이면 먼저 종료
    if (ptyPool.isRunning(targetPaneId)) {
      console.log(`Killing existing PTY for pane ${targetPaneId}`);
      ptyPool.kill(targetPaneId);
      await new Promise(resolve => setTimeout(resolve, 300));
    }

    // 태스크 시작 시간 기록 (첫 패인에서만)
    if (!ptyPool.hasAnyRunning()) {
      usageStore.startTask('current-session');
    }

    // PTY 스폰
    const pid = ptyPool.spawn(targetPaneId, resolvedCwd);

    // PTY 데이터를 렌더러로 전달 (paneId 포함)
    ptyPool.onData(targetPaneId, (data: string) => {
      const windows = BrowserWindow.getAllWindows();
      windows.forEach(win => {
        win.webContents.send('pty:data', targetPaneId, data);
      });
    });

    // PTY 종료 콜백 (paneId 포함)
    ptyPool.onExit(targetPaneId, (exitCode: number) => {
      console.log(`PTY ${targetPaneId} exited, notifying renderer:`, exitCode);
      const windows = BrowserWindow.getAllWindows();
      windows.forEach(win => {
        win.webContents.send('pty:exit', targetPaneId, exitCode);
      });
      // 모든 PTY가 종료되면 세션 감시도 중지
      if (!ptyPool.hasAnyRunning()) {
        sessionWatcher.stop();
      }
    });

    console.log(`Shell spawned for pane ${targetPaneId}. PID:`, pid);
    return pid;
  } catch (error) {
    console.error('PTY spawn error:', error);
    throw error;
  }
});

ipcMain.handle('pty:write', async (_event, paneId: string, data: string) => {
  try {
    // 후방호환: 2인자 호출 시 (paneId=data, data=undefined)
    let targetPaneId = paneId;
    let targetData = data;
    if (data === undefined) {
      targetPaneId = 'pane-default';
      targetData = paneId;
    }

    if (ptyPool.isRunning(targetPaneId)) {
      ptyPool.write(targetPaneId, targetData);
      return true;
    }
    return false;
  } catch (error) {
    console.error('PTY write error:', error);
    return false;
  }
});

// 명령어 전송
ipcMain.handle('pty:write-command', async (_event, paneId: string, text: string) => {
  try {
    let targetPaneId = paneId;
    let targetText = text;
    if (text === undefined) {
      targetPaneId = 'pane-default';
      targetText = paneId;
    }

    if (ptyPool.isRunning(targetPaneId)) {
      ptyPool.writeCommand(targetPaneId, targetText);
      return true;
    }
    return false;
  } catch (error) {
    console.error('PTY write-command error:', error);
    return false;
  }
});

// Claude CLI 세션 감시 시작
ipcMain.handle('pty:start-claude', async (_event, cwd: string) => {
  try {
    if (!ptyPool.hasAnyRunning()) {
      throw new Error('PTY not running');
    }

    console.log('Starting session watcher for:', cwd);
    sessionWatcher.start(cwd);

    return { success: true };
  } catch (error) {
    console.error('Start Claude error:', error);
    throw error;
  }
});

ipcMain.on('pty:resize', (_event, paneId: string, cols: number, rows: number) => {
  try {
    // 후방호환: 3인자 호출 시 (paneId=cols, cols=rows, rows=undefined)
    if (rows === undefined && typeof paneId === 'number') {
      if (ptyPool.isRunning('pane-default')) {
        ptyPool.resize('pane-default', paneId as unknown as number, cols);
      }
      return;
    }

    if (ptyPool.isRunning(paneId)) {
      ptyPool.resize(paneId, cols, rows);
    }
  } catch (error) {
    console.error('PTY resize error:', error);
  }
});

ipcMain.on('pty:kill', (_event, paneId?: string) => {
  try {
    const targetPaneId = paneId || 'pane-default';
    if (ptyPool.isRunning(targetPaneId)) {
      ptyPool.kill(targetPaneId);
    }
    // 모든 PTY가 종료되면 세션 감시 중지
    if (!ptyPool.hasAnyRunning()) {
      sessionWatcher.stop();
    }
  } catch (error) {
    console.error('PTY kill error:', error);
  }
});

ipcMain.on('pty:kill-all', () => {
  try {
    sessionWatcher.stop();
    ptyPool.killAll();
  } catch (error) {
    console.error('PTY kill-all error:', error);
  }
});

// ─────────────────────────────────────────────────────────────
// Usage 핸들러
// ─────────────────────────────────────────────────────────────

ipcMain.handle('usage:get', async (event) => {
  const sessionUsage = sessionWatcher.getUsage();
  const apiUsage = await getUsageData();

  return {
    // 세션 기반 토큰
    tokensUsed: sessionUsage.totalTokens,
    contextLimit: 1000000,
    dailyTokensUsed: sessionUsage.totalTokens,
    inputTokens: sessionUsage.inputTokens,
    outputTokens: sessionUsage.outputTokens,
    cacheReadTokens: sessionUsage.cacheReadTokens,
    cacheCreationTokens: sessionUsage.cacheCreationTokens,
    messageCount: sessionUsage.messageCount,
    // API 기반 사용량 (5시간/7일)
    fiveHourUsage: apiUsage?.fiveHour?.utilization ?? null,
    fiveHourReset: apiUsage?.fiveHour?.remainingTime ?? null,
    sevenDayUsage: apiUsage?.sevenDay?.utilization ?? null,
    sevenDayReset: apiUsage?.sevenDay?.resetDay ?? null
  };
});

// ─────────────────────────────────────────────────────────────
// Skills 핸들러
// ─────────────────────────────────────────────────────────────

ipcMain.handle('skills:list', async () => {
  try {
    const scanner = getSkillScanner();
    const skills = await scanner.scan();
    return skills;
  } catch (error) {
    console.error('Skills list error:', error);
    return [];
  }
});

ipcMain.handle('skills:categorized', async () => {
  try {
    const scanner = getSkillScanner();
    const skills = await scanner.scan();
    return scanner.categorize(skills);
  } catch (error) {
    console.error('Skills categorize error:', error);
    return {};
  }
});

// 스킬 실행 (터미널에 명령어 입력 — 개별 문자 전송)
// 활성 패인의 PTY로 전송 (기본: pane-default)
ipcMain.on('skills:execute', async (_event, command: string) => {
  try {
    // 실행 중인 PTY 중 첫 번째에 전송
    const runningPanes = ptyPool.getRunningPaneIds();
    const targetPaneId = runningPanes[0];

    if (targetPaneId && ptyPool.isRunning(targetPaneId)) {
      const clean = command.trim();
      for (const char of clean) {
        if (!ptyPool.isRunning(targetPaneId)) break;
        ptyPool.write(targetPaneId, char);
        await new Promise(resolve => setTimeout(resolve, 5));
      }
      await new Promise(resolve => setTimeout(resolve, 50));
      if (ptyPool.isRunning(targetPaneId)) {
        ptyPool.write(targetPaneId, '\r');
      }
      console.log('Skill executed (char-by-char):', command);
    } else {
      console.warn('PTY not running, cannot execute skill:', command);
    }
  } catch (error) {
    console.error('Skills execute error:', error);
  }
});

// ─────────────────────────────────────────────────────────────
// MCP 핸들러
// ─────────────────────────────────────────────────────────────

interface MCPServer {
  name: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  status: 'configured' | 'unknown';
}

ipcMain.handle('mcp:list', async () => {
  try {
    const mcpServers: MCPServer[] = [];

    // 1. settings.local.json에서 enabledMcpjsonServers 읽기
    const localSettingsPath = path.join(os.homedir(), '.claude', 'settings.local.json');
    if (fs.existsSync(localSettingsPath)) {
      const localContent = fs.readFileSync(localSettingsPath, 'utf-8');
      const localSettings = JSON.parse(localContent);

      if (localSettings.enabledMcpjsonServers && Array.isArray(localSettings.enabledMcpjsonServers)) {
        for (const serverName of localSettings.enabledMcpjsonServers) {
          mcpServers.push({
            name: serverName,
            status: 'configured'
          });
        }
      }
    }

    // 2. settings.json에서 mcpServers 읽기 (fallback)
    const settingsPath = path.join(os.homedir(), '.claude', 'settings.json');
    if (fs.existsSync(settingsPath)) {
      const content = fs.readFileSync(settingsPath, 'utf-8');
      const settings = JSON.parse(content);

      if (settings.mcpServers) {
        for (const [name, config] of Object.entries(settings.mcpServers)) {
          // 중복 방지
          if (!mcpServers.find(s => s.name === name)) {
            mcpServers.push({
              name,
              ...(config as any),
              status: 'configured'
            });
          }
        }
      }
    }

    return mcpServers;
  } catch (error) {
    console.error('MCP list error:', error);
    return [];
  }
});

// ─────────────────────────────────────────────────────────────
// Config 핸들러
// ─────────────────────────────────────────────────────────────

ipcMain.handle('config:get', async (_event, key: string) => {
  return configStore.get(key);
});

ipcMain.handle('config:set', async (_event, key: string, value: any) => {
  configStore.set(key, value);
});

ipcMain.handle('config:getAll', async () => {
  return configStore.getAll() as Config;
});

// ─────────────────────────────────────────────────────────────
// License 핸들러
// ─────────────────────────────────────────────────────────────

ipcMain.handle('license:activate', async (_event, key: string): Promise<LicenseValidationResult> => {
  try {
    // 형식 검증
    const licensePattern = /^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/;
    if (!licensePattern.test(key)) {
      return {
        isValid: false,
        error: '라이선스 키 형식이 올바르지 않습니다.'
      };
    }

    // 서버 검증
    const isValid = await licenseStore.validate(key);

    if (!isValid) {
      return {
        isValid: false,
        error: '유효하지 않은 라이선스 키입니다.'
      };
    }

    // 암호화하여 저장
    licenseStore.set(key);

    return {
      isValid: true,
      remainingDays: 365 // TODO: 실제 서버 응답에서 받기
    };
  } catch (error) {
    console.error('License activation error:', error);
    return {
      isValid: false,
      error: '라이선스 활성화 중 오류가 발생했습니다.'
    };
  }
});

ipcMain.handle('license:get', async (): Promise<License | null> => {
  try {
    const key = licenseStore.get();

    if (!key) {
      return null;
    }

    // TODO: 서버에서 전체 라이선스 정보 조회
    // 현재는 더미 데이터 반환
    return {
      key,
      activatedAt: new Date(),
      expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      upgradeExpiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      email: 'user@example.com',
      machineId: 'machine-id-placeholder'
    };
  } catch (error) {
    console.error('License get error:', error);
    return null;
  }
});

ipcMain.handle('license:validate', async (): Promise<LicenseValidationResult> => {
  try {
    const key = licenseStore.get();

    if (!key) {
      return {
        isValid: false,
        error: '라이선스가 등록되지 않았습니다.'
      };
    }

    const isValid = await licenseStore.validate(key);

    if (!isValid) {
      return {
        isValid: false,
        error: '라이선스가 유효하지 않습니다.'
      };
    }

    return {
      isValid: true,
      remainingDays: 365 // TODO: 실제 서버 응답
    };
  } catch (error) {
    console.error('License validation error:', error);
    return {
      isValid: false,
      error: '라이선스 검증 중 오류가 발생했습니다.'
    };
  }
});

// ─────────────────────────────────────────────────────────────
// Projects 핸들러
// ─────────────────────────────────────────────────────────────

ipcMain.handle('projects:list', async (): Promise<Project[]> => {
  const projects = projectsStore.get('projects', []);

  // Date 문자열을 Date 객체로 변환
  return projects.map(p => ({
    ...p,
    lastOpened: new Date(p.lastOpened)
  }));
});

ipcMain.handle('projects:add', async (_event, projectPath: string): Promise<Project> => {
  try {
    // 프로젝트 디렉토리 존재 확인
    if (!fs.existsSync(projectPath)) {
      throw new Error('프로젝트 디렉토리를 찾을 수 없습니다.');
    }

    const projects = projectsStore.get('projects', []);
    const name = path.basename(projectPath);

    // 이미 존재하는 프로젝트인지 확인
    const existingIndex = projects.findIndex(p => p.path === projectPath);

    const project: Project = {
      path: projectPath,
      name,
      lastOpened: new Date(),
      skillpackVersion: '1.8.0' // TODO: 실제 버전 감지
    };

    if (existingIndex >= 0) {
      // 기존 프로젝트 업데이트
      projects[existingIndex] = project;
    } else {
      // 새 프로젝트 추가
      projects.unshift(project);
    }

    // 최대 20개까지만 보관
    const trimmedProjects = projects.slice(0, 20);
    projectsStore.set('projects', trimmedProjects);

    return project;
  } catch (error) {
    console.error('Project add error:', error);
    throw error;
  }
});

ipcMain.handle('projects:remove', async (_event, projectPath: string): Promise<void> => {
  const projects = projectsStore.get('projects', []);
  const filtered = projects.filter(p => p.path !== projectPath);
  projectsStore.set('projects', filtered);
});

ipcMain.handle('projects:open', async (_event, projectPath: string): Promise<void> => {
  try {
    // 프로젝트를 최근 목록에 추가/업데이트
    const projects = projectsStore.get('projects', []);
    const name = path.basename(projectPath);

    const project: Project = {
      path: projectPath,
      name,
      lastOpened: new Date(),
      skillpackVersion: '1.8.0' // TODO: 실제 버전 감지
    };

    const existingIndex = projects.findIndex(p => p.path === projectPath);

    if (existingIndex >= 0) {
      projects.splice(existingIndex, 1);
    }

    projects.unshift(project);
    projectsStore.set('projects', projects.slice(0, 20));

    // TODO: 실제로 프로젝트 열기 (터미널 cwd 변경 등)
    console.log('Opening project:', projectPath);
  } catch (error) {
    console.error('Project open error:', error);
    throw error;
  }
});

ipcMain.handle('projects:select-folder', async (): Promise<string | null> => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory'],
    title: '프로젝트 폴더 선택'
  });

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  return result.filePaths[0];
});

// ─────────────────────────────────────────────────────────────
// Update 핸들러
// ─────────────────────────────────────────────────────────────

ipcMain.handle('update:check', async (): Promise<UpdateInfo | null> => {
  try {
    // TODO: 실제 업데이트 서버 API 호출
    // const response = await fetch('https://api.claudelabs.com/api/updates/latest');
    // const data = await response.json();

    // 현재는 더미 데이터 반환
    const currentVersion = app.getVersion();

    // 버전 비교 (간단히 문자열 비교)
    const latestVersion = '1.1.0';

    if (latestVersion === currentVersion) {
      return null; // 업데이트 없음
    }

    return {
      version: latestVersion,
      releaseNotes: '새로운 기능 추가 및 버그 수정',
      downloadUrl: 'https://example.com/download',
      publishedAt: new Date()
    };
  } catch (error) {
    console.error('Update check error:', error);
    return null;
  }
});

ipcMain.handle('update:download', async (): Promise<void> => {
  try {
    // TODO: electron-updater 사용하여 실제 다운로드
    console.log('Download update started');

    // 다운로드 진행 시뮬레이션
    for (let i = 0; i <= 100; i += 10) {
      await new Promise(resolve => setTimeout(resolve, 200));
      // 진행률 이벤트 발송
      // mainWindow.webContents.send('update:progress', i);
    }
  } catch (error) {
    console.error('Update download error:', error);
    throw error;
  }
});

ipcMain.handle('update:install', async (): Promise<void> => {
  try {
    // TODO: electron-updater의 quitAndInstall() 호출
    console.log('Installing update and restarting...');

    // app.relaunch();
    // app.exit();
  } catch (error) {
    console.error('Update install error:', error);
    throw error;
  }
});

// ─────────────────────────────────────────────────────────────
// Window 핸들러
// ─────────────────────────────────────────────────────────────

ipcMain.on('window:minimize', (event) => {
  const win = (event.sender as any).getOwnerBrowserWindow();
  win?.minimize();
});

ipcMain.on('window:maximize', (event) => {
  const win = (event.sender as any).getOwnerBrowserWindow();
  if (win?.isMaximized()) {
    win.unmaximize();
  } else {
    win?.maximize();
  }
});

ipcMain.on('window:close', (event) => {
  const win = (event.sender as any).getOwnerBrowserWindow();
  win?.close();
});

// ─────────────────────────────────────────────────────────────
// Setup 핸들러
// ─────────────────────────────────────────────────────────────

import { getSetupService } from '../setup-service';

const setupService = getSetupService();

ipcMain.handle('setup:status', async () => {
  return setupService.getSetupStatus();
});

ipcMain.handle('setup:run', async () => {
  return setupService.runSetup();
});

ipcMain.handle('setup:check-cli', async () => {
  return setupService.checkClaudeCli();
});

ipcMain.handle('setup:cli-instructions', async () => {
  return setupService.getClaudeCliInstructions();
});

ipcMain.handle('setup:version', async () => {
  return {
    installed: setupService.getInstalledVersion(),
    current: setupService.getCurrentVersion(),
    needsUpgrade: setupService.needsUpgrade()
  };
});

// MCP 설정 관련 핸들러
ipcMain.handle('setup:mcp-status', async () => {
  return setupService.getMcpStatus();
});

ipcMain.handle('setup:mcp-context7', async () => {
  return setupService.setupContext7Mcp();
});

ipcMain.handle('setup:mcp-stitch', async (_event, gcpProjectId: string, apiKey?: string) => {
  return setupService.setupStitchMcp(gcpProjectId, apiKey);
});

ipcMain.handle('setup:mcp-gemini', async () => {
  return setupService.setupGeminiMcp();
});

ipcMain.handle('setup:mcp-github', async (_event, token: string) => {
  return setupService.setupGithubMcp(token);
});

ipcMain.handle('setup:slack-webhook', async (_event, webhookUrl: string) => {
  return setupService.setupSlackWebhook(webhookUrl);
});

ipcMain.handle('setup:gcloud-auth', async () => {
  return setupService.runGcloudAuth();
});

ipcMain.handle('setup:check-gcloud-auth', async () => {
  return setupService.checkGcloudAuth();
});

ipcMain.handle('setup:open-oauth', async (_event, service: 'google' | 'github') => {
  return setupService.openOAuthUrl(service);
});

// ─────────────────────────────────────────────────────────────
// Command History 핸들러
// ─────────────────────────────────────────────────────────────

import type { CommandHistoryEntry } from '@shared/claude-cli';

const historyStore = new Store<{ commandHistory: CommandHistoryEntry[] }>({
  name: 'command-history',
  defaults: { commandHistory: [] }
});

const MAX_HISTORY = 50;

ipcMain.handle('command-history:list', async (): Promise<CommandHistoryEntry[]> => {
  return historyStore.get('commandHistory', []);
});

ipcMain.handle('command-history:add', async (_event, command: string): Promise<void> => {
  const history = historyStore.get('commandHistory', []);
  // 중복 제거 (기존 항목 삭제 후 최상단 삽입)
  const filtered = history.filter(h => h.command !== command);
  filtered.unshift({ command, timestamp: Date.now() });
  historyStore.set('commandHistory', filtered.slice(0, MAX_HISTORY));
});

ipcMain.handle('command-history:remove', async (_event, command: string): Promise<void> => {
  const history = historyStore.get('commandHistory', []);
  historyStore.set('commandHistory', history.filter(h => h.command !== command));
});

ipcMain.handle('command-history:clear', async (): Promise<void> => {
  historyStore.set('commandHistory', []);
});

console.log('✅ IPC handlers registered');

// ─────────────────────────────────────────────────────────────
// 앱 종료 전 정리 함수 (export)
// ─────────────────────────────────────────────────────────────

export function cleanupBeforeQuit(): void {
  console.log('Cleaning up before quit...');

  // 세션 감시 중지
  sessionWatcher.stop();

  // 모든 PTY 프로세스 종료
  console.log('Killing all PTY processes...');
  ptyPool.killAll();

  // 레거시 단일 PTY도 정리
  if (ptyManager.isRunning()) {
    ptyManager.kill();
  }

  console.log('Cleanup complete');
}
