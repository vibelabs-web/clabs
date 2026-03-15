import Store from 'electron-store';

export interface ConfigStoreOptions {
  cwd?: string;
  name?: string;
  defaults?: Record<string, any>;
}

export class ConfigStore {
  private store: Store;

  constructor(options: ConfigStoreOptions = {}) {
    this.store = new Store({
      cwd: options.cwd,
      name: options.name || 'config',
      defaults: options.defaults || {}
    });
  }

  /**
   * Get a value from the config store
   * @param key - The key to retrieve (supports dot notation for nested values)
   * @param defaultValue - Optional default value if key doesn't exist
   * @returns The stored value or default value
   */
  get<T = any>(key: string, defaultValue?: T): T | undefined {
    return this.store.get(key, defaultValue) as T | undefined;
  }

  /**
   * Set a value in the config store
   * @param key - The key to set (supports dot notation for nested values)
   * @param value - The value to store
   */
  set(key: string, value: any): void {
    this.store.set(key, value);
  }

  /**
   * Check if a key exists in the store
   * @param key - The key to check
   * @returns True if the key exists
   */
  has(key: string): boolean {
    return this.store.has(key);
  }

  /**
   * Delete a key from the store
   * @param key - The key to delete
   */
  delete(key: string): void {
    this.store.delete(key);
  }

  /**
   * Clear all data from the store
   */
  clear(): void {
    this.store.clear();
  }

  /**
   * Get the entire store as an object
   * @returns All stored data
   */
  getAll(): Record<string, any> {
    return this.store.store;
  }

  /**
   * Get the file path where the config is stored
   * @returns The absolute path to the config file
   */
  getPath(): string {
    return this.store.path;
  }
}

// Export a singleton instance for app-wide config
let appConfigInstance: ConfigStore | null = null;

export function getAppConfig(): ConfigStore {
  if (!appConfigInstance) {
    appConfigInstance = new ConfigStore({
      name: 'clabs-config',
      defaults: {
        theme: 'default-dark', // 테마 ID (default-dark, gruvbox-dark, dracula 등)
        language: 'ko',
        terminal: {
          shell: process.platform === 'win32' ? 'powershell.exe' : '/bin/bash',
          fontSize: 14,
          fontFamily: 'monospace'
        },
        window: {
          width: 1200,
          height: 800,
          x: undefined,
          y: undefined
        },
        recentProjects: [], // 최근 프로젝트 목록
        toolbarShortcuts: [] // 바로가기 칩 목록
      }
    });
  }
  return appConfigInstance;
}

export function resetAppConfig(): void {
  appConfigInstance = null;
}
