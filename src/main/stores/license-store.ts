import { safeStorage } from 'electron';
import Store from 'electron-store';

/**
 * LicenseStore - 라이선스 키를 안전하게 암호화하여 저장/관리
 *
 * 기능:
 * - safeStorage API를 사용한 라이선스 암호화 저장
 * - 라이선스 형식 검증 (CLABS-XXXX-XXXX-XXXX)
 * - 서버 API를 통한 라이선스 유효성 검증
 */
export class LicenseStore {
  private store: Store;
  private readonly LICENSE_KEY = 'encrypted_license';
  private readonly LICENSE_PATTERN = /^CLABS-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/;
  private readonly VALIDATION_API = 'https://api.claudelabs.com/api/license/validate';

  constructor() {
    this.store = new Store({
      name: 'license',
      encryptionKey: 'clabs-license-encryption',
    });

    if (!safeStorage.isEncryptionAvailable()) {
      console.warn('Encryption is not available on this platform');
    }
  }

  /**
   * 라이선스 저장 (암호화)
   * @param license - 라이선스 키
   */
  set(license: string | null): void {
    if (!license || license.trim() === '') {
      throw new Error('License cannot be empty');
    }

    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('Encryption is not available on this platform');
    }

    const encrypted = safeStorage.encryptString(license);
    this.store.set(this.LICENSE_KEY, encrypted.toString('base64'));
  }

  /**
   * 라이선스 조회 (복호화)
   * @returns 복호화된 라이선스 키 또는 null
   */
  get(): string | null {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('Encryption is not available');
    }

    const encrypted = this.store.get(this.LICENSE_KEY) as string | undefined;

    if (!encrypted) {
      return null;
    }

    try {
      const buffer = Buffer.from(encrypted, 'base64');
      return safeStorage.decryptString(buffer);
    } catch (error) {
      console.error('Failed to decrypt license:', error);
      return null;
    }
  }

  /**
   * 라이선스 형식 유효성 검사
   * @returns 형식이 유효하면 true
   */
  isValid(): boolean {
    const license = this.get();

    if (!license) {
      return false;
    }

    return this.LICENSE_PATTERN.test(license);
  }

  /**
   * 서버를 통한 라이선스 검증
   * @param key - 검증할 라이선스 키
   * @returns 서버 검증 결과
   */
  async validate(key: string): Promise<boolean> {
    try {
      const response = await fetch(this.VALIDATION_API, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ license: key }),
      });

      if (!response.ok) {
        return false;
      }

      const data = await response.json() as { valid: boolean };
      return data.valid === true;
    } catch (error) {
      console.error('License validation error:', error);
      return false;
    }
  }

  /**
   * 라이선스 삭제
   */
  delete(): void {
    this.store.delete(this.LICENSE_KEY);
  }
}
