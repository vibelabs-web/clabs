/**
 * UpdateManager Usage Example
 *
 * This file demonstrates how to integrate UpdateManager into the Electron app.
 */

import { app, BrowserWindow, ipcMain } from 'electron';
import { UpdateManager } from '../update-manager';

// Initialize UpdateManager
const updateManager = new UpdateManager({
  owner: 'claudelabs',
  repo: 'clabs',
  currentVersion: app.getVersion(), // Get version from package.json
});

/**
 * Example 1: Check for updates on app startup
 */
export async function checkUpdatesOnStartup() {
  await app.whenReady();

  const updateInfo = await updateManager.checkForUpdates();

  if (updateInfo) {
    console.log(`New version available: ${updateInfo.version}`);
    console.log(`Release notes: ${updateInfo.releaseNotes}`);

    // Notify renderer process
    const mainWindow = BrowserWindow.getAllWindows()[0];
    mainWindow?.webContents.send('update-available', updateInfo);
  }
}

/**
 * Example 2: Enable auto-check every 6 hours
 */
export function enableAutoUpdateCheck() {
  const SIX_HOURS = 6 * 60 * 60 * 1000;
  updateManager.enableAutoCheck(SIX_HOURS);

  // Listen for manual check requests
  ipcMain.handle('check-for-updates', async () => {
    return await updateManager.checkForUpdates();
  });
}

/**
 * Example 3: Download and install update
 */
export function setupUpdateHandlers() {
  // Handle download request
  ipcMain.handle('download-update', async (event, downloadUrl: string) => {
    const filePath = await updateManager.downloadUpdate(
      downloadUrl,
      (progress) => {
        // Send progress to renderer
        event.sender.send('update-download-progress', progress);
      }
    );
    return filePath;
  });

  // Handle install request
  ipcMain.handle('install-update', async (event, filePath: string) => {
    return await updateManager.installUpdate(filePath);
  });
}

/**
 * Example 4: Full update flow with user confirmation
 */
export async function handleFullUpdateFlow(mainWindow: BrowserWindow) {
  // Check for updates
  const updateInfo = await updateManager.checkForUpdates();

  if (!updateInfo) {
    return; // No updates available
  }

  // Ask user if they want to update
  mainWindow.webContents.send('update-available', updateInfo);

  // Wait for user response
  ipcMain.once('user-wants-update', async () => {
    try {
      // Download update
      const filePath = await updateManager.downloadUpdate(
        updateInfo.downloadUrl,
        (progress) => {
          mainWindow.webContents.send('update-download-progress', progress);
        }
      );

      // Notify download complete
      mainWindow.webContents.send('update-downloaded', { filePath });

      // Wait for user to confirm installation
      ipcMain.once('install-now', async () => {
        await updateManager.installUpdate(filePath);
        // App will quit and installer will run
      });

    } catch (error) {
      mainWindow.webContents.send('update-error', {
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });
}

/**
 * Example 5: Integration with app menu
 */
export function createUpdateMenuItem() {
  return {
    label: 'Check for Updates...',
    click: async () => {
      const mainWindow = BrowserWindow.getAllWindows()[0];

      mainWindow?.webContents.send('checking-for-update');

      const updateInfo = await updateManager.checkForUpdates();

      if (updateInfo) {
        mainWindow?.webContents.send('update-available', updateInfo);
      } else {
        mainWindow?.webContents.send('update-not-available');
      }
    },
  };
}

/**
 * Example 6: Cleanup on app quit
 */
app.on('before-quit', () => {
  updateManager.disableAutoCheck();
});
