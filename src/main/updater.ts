// @TASK P4-T4 - electron-updater 자동 업데이트 설정
// @SPEC docs/planning/04-phase-4-build.md#자동-업데이트

import { autoUpdater } from 'electron-updater';
import { BrowserWindow, dialog } from 'electron';
import log from 'electron-log';

// 업데이트 로깅 활성화
autoUpdater.logger = log;
log.transports.file.level = 'info';

// 자동 다운로드 비활성화 (사용자 동의 후 다운로드)
autoUpdater.autoDownload = false;

export function setupAutoUpdater(mainWindow: BrowserWindow): void {
  // 업데이트 확인 시작
  autoUpdater.on('checking-for-update', () => {
    console.log('Checking for updates...');
  });

  // 업데이트 사용 가능
  autoUpdater.on('update-available', (info) => {
    dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: '업데이트 사용 가능',
      message: `새 버전 ${info.version}이 출시되었습니다.`,
      detail: '지금 다운로드하시겠습니까?',
      buttons: ['다운로드', '나중에'],
      defaultId: 0,
      cancelId: 1,
    }).then((result) => {
      if (result.response === 0) {
        autoUpdater.downloadUpdate();
      }
    });
  });

  // 업데이트 없음
  autoUpdater.on('update-not-available', () => {
    console.log('App is up to date.');
  });

  // 다운로드 진행률
  autoUpdater.on('download-progress', (progressObj) => {
    const logMessage = `다운로드 속도: ${progressObj.bytesPerSecond} - 다운로드 ${progressObj.percent}% (${progressObj.transferred}/${progressObj.total})`;
    console.log(logMessage);

    // 렌더러 프로세스로 진행률 전달
    mainWindow.webContents.send('update-download-progress', progressObj);
  });

  // 다운로드 완료
  autoUpdater.on('update-downloaded', (info) => {
    dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: '업데이트 준비 완료',
      message: `버전 ${info.version} 다운로드가 완료되었습니다.`,
      detail: '지금 재시작하여 업데이트를 적용하시겠습니까?',
      buttons: ['재시작', '나중에'],
      defaultId: 0,
      cancelId: 1,
    }).then((result) => {
      if (result.response === 0) {
        autoUpdater.quitAndInstall();
      }
    });
  });

  // 에러 처리
  autoUpdater.on('error', (err) => {
    console.error('Auto updater error:', err);
    // 자동 업데이트 설정이 없으면 에러 다이얼로그 표시 안 함
    // dialog.showErrorBox('업데이트 오류', err.message);
  });

  // 앱 준비 완료 후 업데이트 확인
  // GitHub 리포 설정 전까지 비활성화
  // autoUpdater.checkForUpdatesAndNotify();
  console.log('Auto updater disabled (no GitHub release configured)');
}
