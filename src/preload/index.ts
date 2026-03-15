import { contextBridge, ipcRenderer } from 'electron';
import type { IPCApi } from '@shared/types';

/**
 * Preload Script - P0-IPC
 *
 * contextBridge를 사용하여 renderer 프로세스에 안전한 API 노출
 * - nodeIntegration: false
 * - contextIsolation: true
 * - sandbox: true
 */

/**
 * Main 프로세스의 API를 Renderer에 안전하게 노출
 */
const api: IPCApi = {
  // PTY (터미널) 관련
  pty: {
    spawn: (command: string, cwd: string) => ipcRenderer.invoke('pty:spawn', command, cwd),
    write: (data: string) => ipcRenderer.send('pty:write', data),
    resize: (cols: number, rows: number) => ipcRenderer.send('pty:resize', cols, rows),
    kill: () => ipcRenderer.send('pty:kill'),
    startClaude: (cwd: string) => ipcRenderer.invoke('pty:start-claude', cwd),
    onData: (callback: (data: string) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, data: string) => callback(data);
      ipcRenderer.on('pty:data', listener);
      return () => ipcRenderer.removeListener('pty:data', listener);
    },
    onExit: (callback: (code: number) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, code: number) => callback(code);
      ipcRenderer.on('pty:exit', listener);
      return () => ipcRenderer.removeListener('pty:exit', listener);
    },
  },

  // Config 관련
  config: {
    get: (key: string) => ipcRenderer.invoke('config:get', key),
    set: (key: string, value: any) => ipcRenderer.invoke('config:set', key, value),
    getAll: () => ipcRenderer.invoke('config:get-all'),
  },

  // License 관련
  license: {
    validate: () => ipcRenderer.invoke('license:validate'),
    activate: (key: string) => ipcRenderer.invoke('license:activate', key),
    get: () => ipcRenderer.invoke('license:get'),
  },

  // Skills 관련
  skills: {
    list: () => ipcRenderer.invoke('skills:list'),
    categorized: () => ipcRenderer.invoke('skills:categorized'),
    execute: (command: string) => ipcRenderer.send('skills:execute', command),
  },

  // MCP 관련
  mcp: {
    list: () => ipcRenderer.invoke('mcp:list'),
  },

  // Projects 관련
  projects: {
    list: () => ipcRenderer.invoke('projects:list'),
    add: (path: string) => ipcRenderer.invoke('projects:add', path),
    remove: (path: string) => ipcRenderer.invoke('projects:remove', path),
    open: (path: string) => ipcRenderer.invoke('projects:open', path),
    selectFolder: () => ipcRenderer.invoke('projects:select-folder'),
  },

  // Update 관련
  update: {
    check: () => ipcRenderer.invoke('update:check'),
    download: () => ipcRenderer.invoke('update:download'),
    install: () => ipcRenderer.invoke('update:install'),
    onProgress: (callback: (progress: number) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, progress: number) => callback(progress);
      ipcRenderer.on('update:progress', listener);
      return () => ipcRenderer.removeListener('update:progress', listener);
    },
  },

  // Window 관련
  window: {
    minimize: () => ipcRenderer.send('window:minimize'),
    maximize: () => ipcRenderer.send('window:maximize'),
    close: () => ipcRenderer.send('window:close'),
  },
};

// contextBridge를 통해 'api' 이름으로 노출
contextBridge.exposeInMainWorld('api', api);
