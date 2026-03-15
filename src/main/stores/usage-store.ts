import Store from 'electron-store';

export interface UsageStoreOptions {
  cwd?: string;
  name?: string;
}

export interface TokenUsage {
  input: number;
  output: number;
  total: number;
}

interface DailyUsage {
  date: string;
  input: number;
  output: number;
  total: number;
}

interface TaskTiming {
  taskId: string;
  startTime: Date;
}

export class UsageStore {
  private store: Store;
  private activeTasks: Map<string, Date>;

  constructor(options: UsageStoreOptions = {}) {
    this.store = new Store({
      cwd: options.cwd,
      name: options.name || 'usage',
      defaults: {}
    });
    this.activeTasks = new Map();
  }

  /**
   * Parse token usage from PTY output
   * Supports multiple formats:
   * - "Token usage: input=1234 output=5678"
   * - '{"tokens":{"input":2000,"output":3000}}'
   * - "Input tokens: 1500"
   *
   * @param data - Raw PTY output data
   * @returns Parsed token usage or null if not found
   */
  parseTokenUsage(data: string): TokenUsage | null {
    try {
      // Try JSON format first
      if (data.includes('{') && data.includes('}')) {
        try {
          // Match nested JSON objects
          const jsonMatch = data.match(/\{(?:[^{}]|\{[^}]*\})*\}/);
          if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            if (parsed.tokens && typeof parsed.tokens.input === 'number') {
              return {
                input: parsed.tokens.input || 0,
                output: parsed.tokens.output || 0,
                total: (parsed.tokens.input || 0) + (parsed.tokens.output || 0)
              };
            }
          }
        } catch {
          // Continue to other formats
        }
      }

      // Standard format: "Token usage: input=1234 output=5678"
      const standardMatch = data.match(/input=(\d+)\s+output=(\d+)/i);
      if (standardMatch) {
        const input = parseInt(standardMatch[1], 10);
        const output = parseInt(standardMatch[2], 10);
        return {
          input,
          output,
          total: input + output
        };
      }

      // Input only: "Input tokens: 1500"
      const inputMatch = data.match(/input\s+tokens?:\s*(\d+)/i);
      if (inputMatch) {
        const input = parseInt(inputMatch[1], 10);
        return {
          input,
          output: 0,
          total: input
        };
      }

      // Output only: "Output tokens: 2000"
      const outputMatch = data.match(/output\s+tokens?:\s*(\d+)/i);
      if (outputMatch) {
        const output = parseInt(outputMatch[1], 10);
        return {
          input: 0,
          output,
          total: output
        };
      }

      return null;
    } catch {
      return null;
    }
  }

  /**
   * Add token usage to today's total
   * @param input - Input tokens count
   * @param output - Output tokens count
   */
  addTokens(input: number, output: number): void {
    // Ensure non-negative values
    const safeInput = Math.max(0, input);
    const safeOutput = Math.max(0, output);

    const today = this.getTodayKey();
    const current = this.store.get(today, { input: 0, output: 0, total: 0 }) as DailyUsage;

    const newInput = (current.input || 0) + safeInput;
    const newOutput = (current.output || 0) + safeOutput;

    this.store.set(today, {
      date: today,
      input: newInput,
      output: newOutput,
      total: newInput + newOutput
    });
  }

  /**
   * Get today's token usage
   * @returns Today's token usage
   */
  getToday(): TokenUsage {
    const today = this.getTodayKey();
    const usage = this.store.get(today, { input: 0, output: 0, total: 0 }) as DailyUsage;

    return {
      input: usage.input || 0,
      output: usage.output || 0,
      total: usage.total || 0
    };
  }

  /**
   * Start tracking time for a task
   * @param taskId - Unique task identifier
   * @returns Task start time
   */
  startTask(taskId: string): Date {
    const startTime = new Date();
    this.activeTasks.set(taskId, startTime);
    return startTime;
  }

  /**
   * End time tracking for a task and calculate duration
   * @param taskId - Unique task identifier
   * @returns Task duration in seconds (0 if task was not started)
   */
  endTask(taskId: string): number {
    const startTime = this.activeTasks.get(taskId);

    if (!startTime) {
      return 0;
    }

    const endTime = new Date();
    const durationMs = endTime.getTime() - startTime.getTime();
    const durationSeconds = durationMs / 1000;

    // Remove from active tasks
    this.activeTasks.delete(taskId);

    return durationSeconds;
  }

  /**
   * Get today's date key in YYYY-MM-DD format
   * @returns Date key string
   */
  private getTodayKey(): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  /**
   * Get usage for a specific date
   * @param date - Date key in YYYY-MM-DD format
   * @returns Token usage for the date
   */
  getUsageByDate(date: string): TokenUsage {
    const usage = this.store.get(date, { input: 0, output: 0, total: 0 }) as DailyUsage;

    return {
      input: usage.input || 0,
      output: usage.output || 0,
      total: usage.total || 0
    };
  }

  /**
   * Get all usage history
   * @returns Object with date keys and usage values
   */
  getAllUsage(): Record<string, TokenUsage> {
    return this.store.store as Record<string, TokenUsage>;
  }

  /**
   * Clear all usage data
   */
  clear(): void {
    this.store.clear();
  }

  /**
   * Get the file path where usage data is stored
   * @returns The absolute path to the usage file
   */
  getPath(): string {
    return this.store.path;
  }
}

// Export a singleton instance for app-wide usage tracking
let appUsageInstance: UsageStore | null = null;

export function getAppUsage(): UsageStore {
  if (!appUsageInstance) {
    appUsageInstance = new UsageStore({
      name: 'clabs-usage'
    });
  }
  return appUsageInstance;
}

export function resetAppUsage(): void {
  appUsageInstance = null;
}
