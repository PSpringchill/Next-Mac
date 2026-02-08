import { describe, it, expect } from 'vitest';
import SecureKeyManager from '../app/components/TradingEngine/SecureKeyManager';

describe('SecureKeyManager', () => {
  describe('validateApiKeyFormat()', () => {
    it('rejects empty key', () => {
      expect(SecureKeyManager.validateApiKeyFormat('').valid).toBe(false);
      expect(SecureKeyManager.validateApiKeyFormat('   ').valid).toBe(false);
    });

    it('rejects short key', () => {
      expect(SecureKeyManager.validateApiKeyFormat('abc').valid).toBe(false);
    });

    it('rejects key with whitespace', () => {
      expect(SecureKeyManager.validateApiKeyFormat('abc def ghij klmn').valid).toBe(false);
    });

    it('rejects placeholder keys', () => {
      expect(SecureKeyManager.validateApiKeyFormat('your_api_key_here').valid).toBe(false);
      expect(SecureKeyManager.validateApiKeyFormat('xxxxxxxxxxxxx').valid).toBe(false);
      expect(SecureKeyManager.validateApiKeyFormat('REPLACE_ME_WITH_KEY').valid).toBe(false);
    });

    it('accepts valid key', () => {
      expect(SecureKeyManager.validateApiKeyFormat('a1b2c3d4e5f6g7h8i9j0').valid).toBe(true);
    });
  });

  describe('maskApiKey()', () => {
    it('masks long keys showing first 4 and last 4', () => {
      expect(SecureKeyManager.maskApiKey('a1b2c3d4e5f6g7h8i9j0')).toBe('a1b2****i9j0');
    });

    it('masks short keys completely', () => {
      expect(SecureKeyManager.maskApiKey('abcd')).toBe('****');
    });
  });

  describe('fromEnvironment()', () => {
    it('returns null when env vars not set', () => {
      const creds = SecureKeyManager.fromEnvironment('NONEXISTENT_PREFIX');
      expect(creds).toBeNull();
    });
  });

  describe('credential storage lifecycle', () => {
    it('hasStoredCredentials returns false initially', () => {
      const mgr = new SecureKeyManager({ storageKey: 'test_key_' + Date.now() });
      expect(mgr.hasStoredCredentials()).toBe(false);
    });

    it('clearCredentials does not throw', () => {
      const mgr = new SecureKeyManager();
      expect(() => mgr.clearCredentials()).not.toThrow();
    });
  });

  describe('password validation', () => {
    it('rejects short passwords on store', async () => {
      const mgr = new SecureKeyManager();
      await expect(
        mgr.storeCredentials(
          { apiKey: 'a1b2c3d4e5f6g7h8', apiSecret: 'x1y2z3w4v5u6t7s8' },
          'short'
        )
      ).rejects.toThrow('password');
    });

    it('rejects invalid credentials on store', async () => {
      const mgr = new SecureKeyManager();
      await expect(
        mgr.storeCredentials(
          { apiKey: '', apiSecret: 'x1y2z3w4v5u6t7s8' },
          'longpassword123'
        )
      ).rejects.toThrow();
    });
  });
});
