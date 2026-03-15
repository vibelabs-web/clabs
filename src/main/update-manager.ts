import { app } from 'electron';
import { spawn } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

export interface UpdateInfo {
  version: string;
  releaseNotes: string;
  downloadUrl: string;
  publishedAt: string;
  fileSize: number;
}

export interface DownloadProgress {
  percent: number;
  transferred: number;
  total: number;
}

export interface UpdateManagerOptions {
  owner: string;
  repo: string;
  currentVersion: string;
}

export class UpdateManager {
  private owner: string;
  private repo: string;
  private currentVersion: string;
  private checkInterval?: NodeJS.Timeout;

  constructor(options: UpdateManagerOptions) {
    this.owner = options.owner;
    this.repo = options.repo;
    this.currentVersion = options.currentVersion.replace(/^v/, '');
  }

  /**
   * Check for updates from GitHub Releases
   */
  async checkForUpdates(): Promise<UpdateInfo | null> {
    try {
      const url = `https://api.github.com/repos/${this.owner}/${this.repo}/releases/latest`;
      const response = await fetch(url, {
        headers: {
          'Accept': 'application/vnd.github.v3+json',
          'User-Agent': 'clabs-update-checker',
        },
      });

      if (!response.ok) {
        if (response.status === 403) {
          console.warn('GitHub API rate limit exceeded');
        }
        return null;
      }

      const release = await response.json();
      const latestVersion = release.tag_name.replace(/^v/, '');

      if (!this.isNewerVersion(latestVersion)) {
        return null;
      }

      // Find the appropriate asset for current platform
      const asset = this.selectAssetForPlatform(release.assets);
      if (!asset) {
        console.warn('No suitable asset found for current platform');
        return null;
      }

      return {
        version: latestVersion,
        releaseNotes: release.body || '',
        downloadUrl: asset.browser_download_url,
        publishedAt: release.published_at,
        fileSize: asset.size,
      };
    } catch (error) {
      console.error('Failed to check for updates:', error);
      return null;
    }
  }

  /**
   * Download update file with progress reporting
   */
  async downloadUpdate(
    downloadUrl: string,
    onProgress?: (progress: DownloadProgress) => void
  ): Promise<string> {
    try {
      const response = await fetch(downloadUrl);
      if (!response.ok) {
        throw new Error(`Failed to download: ${response.statusText}`);
      }

      const totalBytes = parseInt(response.headers.get('content-length') || '0', 10);
      let transferredBytes = 0;

      // Create temp directory for download
      const tempDir = os.tmpdir();
      const fileName = path.basename(new URL(downloadUrl).pathname);
      const filePath = path.join(tempDir, fileName);

      // Stream download with progress
      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('Failed to get response body reader');
      }

      const chunks: Uint8Array[] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        chunks.push(value);
        transferredBytes += value.length;

        if (onProgress && totalBytes > 0) {
          onProgress({
            percent: (transferredBytes / totalBytes) * 100,
            transferred: transferredBytes,
            total: totalBytes,
          });
        }
      }

      // Write to file
      const buffer = Buffer.concat(chunks);
      await fs.writeFile(filePath, buffer);

      return filePath;
    } catch (error) {
      console.error('Download failed:', error);
      throw error;
    }
  }

  /**
   * Install downloaded update and restart app
   */
  async installUpdate(filePath: string): Promise<boolean> {
    try {
      const platform = process.platform;

      if (platform === 'darwin') {
        // macOS: Open DMG file
        return await this.installMacUpdate(filePath);
      } else if (platform === 'win32') {
        // Windows: Run installer
        return await this.installWindowsUpdate(filePath);
      } else if (platform === 'linux') {
        // Linux: Install AppImage or deb
        return await this.installLinuxUpdate(filePath);
      }

      throw new Error(`Unsupported platform: ${platform}`);
    } catch (error) {
      console.error('Installation failed:', error);
      throw error;
    }
  }

  /**
   * Enable automatic update checking
   */
  enableAutoCheck(intervalMs: number): void {
    this.disableAutoCheck();
    this.checkInterval = setInterval(() => {
      this.checkForUpdates().catch(console.error);
    }, intervalMs);
  }

  /**
   * Disable automatic update checking
   */
  disableAutoCheck(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = undefined;
    }
  }

  /**
   * Compare version strings
   */
  private isNewerVersion(remoteVersion: string): boolean {
    const remote = remoteVersion.replace(/^v/, '').split('.').map(Number);
    const current = this.currentVersion.split('.').map(Number);

    for (let i = 0; i < 3; i++) {
      const r = remote[i] || 0;
      const c = current[i] || 0;

      if (r > c) return true;
      if (r < c) return false;
    }

    return false;
  }

  /**
   * Select appropriate asset for current platform
   */
  private selectAssetForPlatform(assets: any[]): any {
    const platform = process.platform;
    const arch = process.arch;

    const platformPatterns: Record<string, RegExp[]> = {
      darwin: [/\.dmg$/, /mac/i, /darwin/i],
      win32: [/\.exe$/, /win/i, /windows/i],
      linux: [/\.AppImage$/, /\.deb$/, /linux/i],
    };

    const patterns = platformPatterns[platform] || [];

    for (const pattern of patterns) {
      const asset = assets.find((a: any) => pattern.test(a.name));
      if (asset) return asset;
    }

    return null;
  }

  /**
   * Install update on macOS
   */
  private async installMacUpdate(filePath: string): Promise<boolean> {
    return new Promise((resolve, reject) => {
      const child = spawn('open', [filePath]);

      child.on('close', (code) => {
        if (code === 0) {
          // Quit app to allow user to install
          app.quit();
          resolve(true);
        } else {
          reject(new Error(`Installation failed with code ${code}`));
        }
      });

      child.on('error', reject);
    });
  }

  /**
   * Install update on Windows
   */
  private async installWindowsUpdate(filePath: string): Promise<boolean> {
    return new Promise((resolve, reject) => {
      const child = spawn(filePath, ['/S'], {
        detached: true,
        stdio: 'ignore',
      });

      child.unref();

      // Quit app to allow installer to replace files
      setTimeout(() => {
        app.quit();
        resolve(true);
      }, 1000);
    });
  }

  /**
   * Install update on Linux
   */
  private async installLinuxUpdate(filePath: string): Promise<boolean> {
    if (filePath.endsWith('.AppImage')) {
      // Make AppImage executable and launch
      await fs.chmod(filePath, 0o755);
      spawn(filePath, [], {
        detached: true,
        stdio: 'ignore',
      });
      app.quit();
      return true;
    } else if (filePath.endsWith('.deb')) {
      // Use system package manager
      return new Promise((resolve, reject) => {
        const child = spawn('pkexec', ['dpkg', '-i', filePath]);

        child.on('close', (code) => {
          if (code === 0) {
            app.quit();
            resolve(true);
          } else {
            reject(new Error(`Installation failed with code ${code}`));
          }
        });

        child.on('error', reject);
      });
    }

    throw new Error('Unsupported package format');
  }
}
