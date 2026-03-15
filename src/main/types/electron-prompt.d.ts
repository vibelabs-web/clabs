declare module 'electron-prompt' {
  interface PromptOptions {
    title?: string;
    label?: string;
    value?: string;
    inputAttrs?: Record<string, string>;
    type?: 'input' | 'select';
    selectOptions?: Record<string, string>;
    useHtmlLabel?: boolean;
    width?: number;
    height?: number;
    resizable?: boolean;
    alwaysOnTop?: boolean;
    icon?: string;
    customStylesheet?: string;
    menuBarVisible?: boolean;
    skipTaskbar?: boolean;
  }

  function prompt(options?: PromptOptions, parentWindow?: Electron.BrowserWindow): Promise<string | null>;
  export = prompt;
}
