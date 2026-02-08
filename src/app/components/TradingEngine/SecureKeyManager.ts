// src/tradingEngine/SecureKeyManager.ts
// Secure handling of API keys and exchange credentials
// Uses AES-GCM encryption via Web Crypto API (browser-compatible)

export interface ExchangeCredentials {
  apiKey: string;
  apiSecret: string;
  passphrase?: string;
}

export interface EncryptedCredentials {
  ciphertext: string;  // base64
  iv: string;          // base64
  salt: string;        // base64
  tag: string;         // included in ciphertext for AES-GCM
}

export interface KeyManagerConfig {
  storageKey: string;
  pbkdf2Iterations: number;
  keyLength: number;
}

const DEFAULT_CONFIG: KeyManagerConfig = {
  storageKey: 'trading_encrypted_creds',
  pbkdf2Iterations: 100_000,
  keyLength: 256,
};

// ─── Secure Key Manager ──────────────────────────────────────────────────────

class SecureKeyManager {
  private config: KeyManagerConfig;
  private cachedKey: CryptoKey | null = null;
  private keyExpiry: number = 0;
  private readonly KEY_TTL_MS = 5 * 60 * 1000;  // Cache key for 5 minutes

  constructor(config: Partial<KeyManagerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // ─── Encrypt and Store Credentials ────────────────────────────────────────

  async storeCredentials(
    credentials: ExchangeCredentials,
    masterPassword: string
  ): Promise<EncryptedCredentials> {
    this.validateCredentials(credentials);
    this.validatePassword(masterPassword);

    const plaintext = JSON.stringify(credentials);
    const encrypted = await this.encrypt(plaintext, masterPassword);

    // Store in localStorage (encrypted)
    try {
      if (typeof window !== 'undefined' && window.localStorage && typeof window.localStorage.setItem === 'function') {
        window.localStorage.setItem(this.config.storageKey, JSON.stringify(encrypted));
      }
    } catch {
      // Ignore storage errors in restricted environments
    }

    return encrypted;
  }

  // ─── Retrieve and Decrypt Credentials ─────────────────────────────────────

  async retrieveCredentials(masterPassword: string): Promise<ExchangeCredentials | null> {
    const stored = this.getStoredEncrypted();
    if (!stored) return null;

    try {
      const plaintext = await this.decrypt(stored, masterPassword);
      return JSON.parse(plaintext) as ExchangeCredentials;
    } catch {
      throw new Error('Failed to decrypt credentials. Wrong password or corrupted data.');
    }
  }

  // ─── Check if Credentials Exist ───────────────────────────────────────────

  hasStoredCredentials(): boolean {
    return this.getStoredEncrypted() !== null;
  }

  // ─── Remove Stored Credentials ────────────────────────────────────────────

  clearCredentials(): void {
    try {
      if (typeof window !== 'undefined' && window.localStorage && typeof window.localStorage.removeItem === 'function') {
        window.localStorage.removeItem(this.config.storageKey);
      }
    } catch {
      // Ignore storage errors in restricted environments
    }
    this.cachedKey = null;
    this.keyExpiry = 0;
  }

  // ─── Mask API Key for Display ─────────────────────────────────────────────

  static maskApiKey(key: string): string {
    if (key.length <= 8) return '****';
    return key.slice(0, 4) + '****' + key.slice(-4);
  }

  // ─── Validate API Key Format ──────────────────────────────────────────────

  static validateApiKeyFormat(key: string): { valid: boolean; reason?: string } {
    if (!key || key.trim().length === 0) {
      return { valid: false, reason: 'API key is empty' };
    }
    if (key.length < 10) {
      return { valid: false, reason: 'API key is too short' };
    }
    if (/\s/.test(key)) {
      return { valid: false, reason: 'API key contains whitespace' };
    }
    // Check for common patterns that indicate a placeholder
    const placeholders = ['your_api_key', 'xxx', 'REPLACE_ME', 'INSERT_KEY'];
    for (const p of placeholders) {
      if (key.toLowerCase().includes(p.toLowerCase())) {
        return { valid: false, reason: `API key appears to be a placeholder: "${p}"` };
      }
    }
    return { valid: true };
  }

  // ─── Environment Variable Reader ──────────────────────────────────────────

  static fromEnvironment(prefix: string = 'EXCHANGE'): ExchangeCredentials | null {
    if (typeof process === 'undefined') return null;

    const apiKey = process.env[`${prefix}_API_KEY`] || process.env[`NEXT_PUBLIC_${prefix}_API_KEY`];
    const apiSecret = process.env[`${prefix}_API_SECRET`] || process.env[`NEXT_PUBLIC_${prefix}_API_SECRET`];
    const passphrase = process.env[`${prefix}_PASSPHRASE`] || process.env[`NEXT_PUBLIC_${prefix}_PASSPHRASE`];

    if (!apiKey || !apiSecret) return null;
    return { apiKey, apiSecret, passphrase: passphrase || undefined };
  }

  // ─── Crypto Internals ─────────────────────────────────────────────────────

  private async encrypt(plaintext: string, password: string): Promise<EncryptedCredentials> {
    const crypto = this.getCrypto();
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await this.deriveKey(password, salt.buffer);

    const encoded = new TextEncoder().encode(plaintext);
    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      encoded
    );

    return {
      ciphertext: this.bufferToBase64(ciphertext),
      iv: this.bufferToBase64(iv.buffer as ArrayBuffer),
      salt: this.bufferToBase64(salt.buffer as ArrayBuffer),
      tag: '',  // Included in GCM ciphertext
    };
  }

  private async decrypt(encrypted: EncryptedCredentials, password: string): Promise<string> {
    const crypto = this.getCrypto();
    const salt = this.base64ToBuffer(encrypted.salt);
    const iv = this.base64ToBuffer(encrypted.iv);
    const ciphertext = this.base64ToBuffer(encrypted.ciphertext);
    const key = await this.deriveKey(password, new Uint8Array(salt).buffer);

    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: new Uint8Array(iv) },
      key,
      ciphertext
    );

    return new TextDecoder().decode(decrypted);
  }

  private async deriveKey(password: string, salt: Uint8Array | ArrayBuffer): Promise<CryptoKey> {
    const now = Date.now();
    if (this.cachedKey && now < this.keyExpiry) {
      return this.cachedKey;
    }

    const crypto = this.getCrypto();
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(password),
      'PBKDF2',
      false,
      ['deriveKey']
    );

    const key = await crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: new Uint8Array(salt),
        iterations: this.config.pbkdf2Iterations,
        hash: 'SHA-256',
      },
      keyMaterial,
      { name: 'AES-GCM', length: this.config.keyLength },
      false,
      ['encrypt', 'decrypt']
    );

    this.cachedKey = key;
    this.keyExpiry = now + this.KEY_TTL_MS;
    return key;
  }

  private getCrypto(): Crypto {
    if (typeof globalThis !== 'undefined' && globalThis.crypto) {
      return globalThis.crypto;
    }
    throw new Error('Web Crypto API not available in this environment');
  }

  private bufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  private base64ToBuffer(base64: string): ArrayBuffer {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
  }

  private getStoredEncrypted(): EncryptedCredentials | null {
    try {
      if (typeof window === 'undefined' || !window.localStorage || typeof window.localStorage.getItem !== 'function') return null;
      const raw = window.localStorage.getItem(this.config.storageKey);
      if (!raw) return null;
      return JSON.parse(raw) as EncryptedCredentials;
    } catch {
      return null;
    }
  }

  private validateCredentials(creds: ExchangeCredentials): void {
    const keyCheck = SecureKeyManager.validateApiKeyFormat(creds.apiKey);
    if (!keyCheck.valid) throw new Error(`Invalid API key: ${keyCheck.reason}`);
    const secretCheck = SecureKeyManager.validateApiKeyFormat(creds.apiSecret);
    if (!secretCheck.valid) throw new Error(`Invalid API secret: ${secretCheck.reason}`);
  }

  private validatePassword(password: string): void {
    if (!password || password.length < 8) {
      throw new Error('Master password must be at least 8 characters');
    }
  }
}

export default SecureKeyManager;
