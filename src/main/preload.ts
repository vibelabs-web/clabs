import { contextBridge, ipcRenderer } from 'electron';
import type { IPCApi, Config, Skill, Project, License, LicenseValidationResult, UpdateInfo, OpenDialogOptions, OpenDialogResult, UsageUpdateData } from '../shared/types';

const api: IPCApi = {
  pty: {
    spawn: (command: string, cwd: string, paneId?: string) =>
      ipcRenderer.invoke('pty:spawn', command, cwd, paneId || 'pane-default'),
    write: (data: string, paneId?: string) =>
      ipcRenderer.invoke('pty:write', paneId || 'pane-default', data),
    writeCommand: (text: string, paneId?: string) =>
      ipcRenderer.invoke('pty:write-command', paneId || 'pane-default', text),
    resize: (cols: number, rows: number, paneId?: string) =>
      ipcRenderer.send('pty:resize', paneId || 'pane-default', cols, rows),
    kill: (paneId?: string) =>
      ipcRenderer.send('pty:kill', paneId || 'pane-default'),
    killAll: () => ipcRenderer.send('pty:kill-all'),
    startClaude: (cwd: string) => ipcRenderer.invoke('pty:start-claude', cwd),
    onData: (callback: (paneId: string, data: string) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, paneId: string, data: string) =>
        callback(paneId, data);
      ipcRenderer.on('pty:data', listener);
      return () => ipcRenderer.removeListener('pty:data', listener);
    },
    onExit: (callback: (paneId: string, code: number) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, paneId: string, code: number) =>
        callback(paneId, code);
      ipcRenderer.on('pty:exit', listener);
      return () => ipcRenderer.removeListener('pty:exit', listener);
    },
  },

  config: {
    get: <K extends keyof Config>(key: K) => ipcRenderer.invoke('config:get', key),
    set: <K extends keyof Config>(key: K, value: Config[K]) => ipcRenderer.invoke('config:set', key, value),
    getAll: () => ipcRenderer.invoke('config:getAll'),
  },

  license: {
    validate: () => ipcRenderer.invoke('license:validate'),
    activate: (key: string) => ipcRenderer.invoke('license:activate', key),
    get: () => ipcRenderer.invoke('license:get'),
  },

  skills: {
    list: () => ipcRenderer.invoke('skills:list'),
    categorized: () => ipcRenderer.invoke('skills:categorized'),
    execute: (command: string) => ipcRenderer.send('skills:execute', command),
  },

  mcp: {
    list: () => ipcRenderer.invoke('mcp:list'),
  },

  usage: {
    get: () => ipcRenderer.invoke('usage:get'),
    onUpdate: (callback: (data: UsageUpdateData) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, data: UsageUpdateData) => callback(data);
      ipcRenderer.on('usage:update', listener);
      return () => ipcRenderer.removeListener('usage:update', listener);
    },
  },

  projects: {
    list: () => ipcRenderer.invoke('projects:list'),
    add: (path: string) => ipcRenderer.invoke('projects:add', path),
    remove: (path: string) => ipcRenderer.invoke('projects:remove', path),
    open: (path: string) => ipcRenderer.invoke('projects:open', path),
    selectFolder: () => ipcRenderer.invoke('projects:select-folder'),
  },

  dialog: {
    showOpenDialog: (options: OpenDialogOptions) => ipcRenderer.invoke('dialog:showOpenDialog', options),
  },

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

  window: {
    minimize: () => ipcRenderer.send('window:minimize'),
    maximize: () => ipcRenderer.send('window:maximize'),
    close: () => ipcRenderer.send('window:close'),
  },

  setup: {
    status: () => ipcRenderer.invoke('setup:status'),
    run: () => ipcRenderer.invoke('setup:run'),
    checkCli: () => ipcRenderer.invoke('setup:check-cli'),
    cliInstructions: () => ipcRenderer.invoke('setup:cli-instructions'),
    version: () => ipcRenderer.invoke('setup:version'),
    // MCP 설정
    mcpStatus: () => ipcRenderer.invoke('setup:mcp-status'),
    setupContext7: () => ipcRenderer.invoke('setup:mcp-context7'),
    setupStitch: (gcpProjectId: string, apiKey?: string) => ipcRenderer.invoke('setup:mcp-stitch', gcpProjectId, apiKey),
    setupGemini: () => ipcRenderer.invoke('setup:mcp-gemini'),
    setupGithub: (token: string) => ipcRenderer.invoke('setup:mcp-github', token),
    setupSlackWebhook: (webhookUrl: string) => ipcRenderer.invoke('setup:slack-webhook', webhookUrl),
    gcloudAuth: () => ipcRenderer.invoke('setup:gcloud-auth'),
    checkGcloudAuth: () => ipcRenderer.invoke('setup:check-gcloud-auth'),
    openOAuth: (service: 'google' | 'github') => ipcRenderer.invoke('setup:open-oauth', service),
  },

  commandHistory: {
    list: () => ipcRenderer.invoke('command-history:list'),
    add: (command: string) => ipcRenderer.invoke('command-history:add', command),
    remove: (command: string) => ipcRenderer.invoke('command-history:remove', command),
    clear: () => ipcRenderer.invoke('command-history:clear'),
  },
};

contextBridge.exposeInMainWorld('api', api);
