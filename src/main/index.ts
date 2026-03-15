import { app, BrowserWindow, dialog } from 'electron';
import path from 'path';
import { setupAutoUpdater } from './updater';
import { cleanupBeforeQuit } from './ipc/handlers';
import { getSetupService } from './setup-service';
import log from 'electron-log';

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
try {
  if (require('electron-squirrel-startup')) {
    app.quit();
  }
} catch {
  // electron-squirrel-startup is only needed for Windows installer
}

let mainWindow: BrowserWindow | null = null;

const createWindow = (): void => {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 600,
    frame: false, // 커스텀 타이틀바
    backgroundColor: '#1a1a1a',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      webSecurity: false, // file:// 프로토콜에서 ES module 로드 허용
    },
  });

  // Development or Production
  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    // 프로덕션: 렌더러 HTML 로드
    // __dirname은 dist/main/src/main/ 이므로 상위로 올라가야 함
    const rendererPath = path.join(__dirname, '..', '..', '..', 'renderer', 'index.html');
    console.log('App path:', app.getAppPath());
    console.log('__dirname:', __dirname);
    console.log('Loading renderer from:', rendererPath);

    mainWindow.loadFile(rendererPath).catch((err) => {
      console.error('Failed to load renderer:', err);
      // Fallback: app.getAppPath() 기준 시도
      const fallbackPath = path.join(app.getAppPath(), 'dist', 'renderer', 'index.html');
      console.log('Trying fallback path:', fallbackPath);
      mainWindow?.loadFile(fallbackPath).catch((err2) => {
        console.error('Fallback also failed:', err2);
      });
    });
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // @TASK P4-T4 - 자동 업데이트 활성화
  // @SPEC docs/planning/04-phase-4-build.md#자동-업데이트
  if (process.env.NODE_ENV !== 'development') {
    setupAutoUpdater(mainWindow);
  }
};

app.whenReady().then(async () => {
  // Run setup check before creating window
  const setupService = getSetupService();

  // 스킬팩 설치/업데이트만 수행 (MCP 설정은 install.sh/install.ps1에서 처리)
  if (setupService.isFirstLaunch() || setupService.needsUpgrade()) {
    log.info('Running skillpack setup or upgrade...');

    const result = await setupService.runSetup();

    if (!result.success) {
      log.error('Setup failed:', result.message);
      dialog.showMessageBox({
        type: 'error',
        title: '스킬팩 설치 오류',
        message: result.message,
        detail: (result.details || []).join('\n'),
        buttons: ['확인']
      });
    } else {
      log.info('Skillpack setup completed successfully');
      // MCP 설정은 install.sh/install.ps1 스크립트에서 이미 완료됨
      // 앱에서는 별도의 MCP 설정 다이얼로그를 표시하지 않음
    }
  }

  // Check Claude CLI availability
  const hasClaudeCli = await setupService.checkClaudeCli();
  if (!hasClaudeCli) {
    log.warn('Claude CLI not found');
    const response = await dialog.showMessageBox({
      type: 'warning',
      title: 'Claude Code CLI 필요',
      message: 'Claude Code CLI가 설치되어 있지 않습니다.',
      detail: setupService.getClaudeCliInstructions(),
      buttons: ['확인', '나중에']
    });
    log.info('User response to CLI warning:', response.response);
  }

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  // macOS에서도 창 닫으면 앱 완전 종료
  app.quit();
});

// 앱 종료 전 PTY 프로세스 정리
app.on('before-quit', () => {
  console.log('App quitting, cleaning up...');
  cleanupBeforeQuit();
});

// IPC 핸들러 등록 (cleanupBeforeQuit는 위에서 import)
