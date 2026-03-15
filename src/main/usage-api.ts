// @TASK Usage API - Anthropic OAuth API를 통한 사용량 조회
// awesome-statusline 플러그인 방식 참고

import { exec } from 'child_process';
import { promisify } from 'util';
import https from 'https';

const execAsync = promisify(exec);

interface UsageData {
  fiveHour: {
    utilization: number;
    resetsAt: string | null;
    remainingTime: string;
  };
  sevenDay: {
    utilization: number;
    resetsAt: string | null;
    resetDay: string;
  };
}

interface CachedUsage {
  data: UsageData;
  timestamp: number;
}

// 캐시 (5분)
let usageCache: CachedUsage | null = null;
const CACHE_TTL = 5 * 60 * 1000; // 5분

/**
 * macOS Keychain에서 Claude Code OAuth 토큰 가져오기
 */
async function getOAuthToken(): Promise<string | null> {
  try {
    const { stdout } = await execAsync(
      'security find-generic-password -s "Claude Code-credentials" -w 2>/dev/null'
    );

    const credentials = JSON.parse(stdout.trim());
    return credentials?.claudeAiOauth?.accessToken || null;
  } catch (error) {
    console.error('Failed to get OAuth token:', error);
    return null;
  }
}

/**
 * Anthropic Usage API 호출
 */
function fetchUsageFromAPI(token: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.anthropic.com',
      path: '/api/oauth/usage',
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'anthropic-beta': 'oauth-2025-04-20'
      },
      timeout: 5000
    };

    const req = https.request(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve(json);
        } catch (e) {
          reject(new Error('Invalid JSON response'));
        }
      });
    });

    req.on('error', (error) => {
      reject(error);
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });

    req.end();
  });
}

/**
 * 남은 시간 포맷팅 (5시간용)
 */
function formatTimeRemaining(isoTs: string | null): string {
  if (!isoTs) return '--';

  try {
    const resetTime = new Date(isoTs).getTime();
    const now = Date.now();
    const remaining = Math.max(0, resetTime - now);

    const hours = Math.floor(remaining / (1000 * 60 * 60));
    const minutes = Math.floor((remaining % (1000 * 60 * 60)) / (1000 * 60));

    return `${hours}h${minutes}m`;
  } catch {
    return '--';
  }
}

/**
 * 리셋 요일 포맷팅 (7일용)
 */
function formatResetDay(isoTs: string | null): string {
  if (!isoTs) return '--';

  try {
    const resetDate = new Date(isoTs);
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    return days[resetDate.getDay()];
  } catch {
    return '--';
  }
}

/**
 * 사용량 데이터 조회 (캐시 포함)
 */
export async function getUsageData(): Promise<UsageData | null> {
  // 캐시 확인
  if (usageCache && Date.now() - usageCache.timestamp < CACHE_TTL) {
    return usageCache.data;
  }

  try {
    const token = await getOAuthToken();
    if (!token) {
      console.log('No OAuth token available');
      return null;
    }

    const response = await fetchUsageFromAPI(token);

    if (!response.five_hour) {
      console.log('Invalid usage response:', response);
      return null;
    }

    const data: UsageData = {
      fiveHour: {
        utilization: Math.round(response.five_hour?.utilization || 0),
        resetsAt: response.five_hour?.resets_at || null,
        remainingTime: formatTimeRemaining(response.five_hour?.resets_at)
      },
      sevenDay: {
        utilization: Math.round(response.seven_day?.utilization || 0),
        resetsAt: response.seven_day?.resets_at || null,
        resetDay: formatResetDay(response.seven_day?.resets_at)
      }
    };

    // 캐시 저장
    usageCache = { data, timestamp: Date.now() };

    console.log('Usage data fetched:', data);
    return data;
  } catch (error) {
    console.error('Failed to fetch usage data:', error);
    return null;
  }
}

/**
 * 캐시 초기화
 */
export function clearUsageCache(): void {
  usageCache = null;
}
