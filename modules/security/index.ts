import path from 'path';

export class SecurityValidator {
  /**
   * Validates that an IP address is a valid IPv4 address
   */
  static isValidIPv4(ip: string): boolean {
    const ipv4Regex = /^(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
    return ipv4Regex.test(ip.trim());
  }

  /**
   * Validates a network port number (1-65535)
   */
  static isValidPort(port: number | string): boolean {
    const p = typeof port === 'string' ? parseInt(port, 10) : port;
    return !isNaN(p) && p >= 1 && p <= 65535;
  }

  /**
   * Validates a device serial number to prevent shell metacharacter injection
   */
  static isValidSerial(serial: string): boolean {
    // Alphanumeric, dots, dashes, colons (for IP:port serials), underscores
    const serialRegex = /^[a-zA-Z0-9.\-_:]+$/;
    return typeof serial === 'string' && serial.length > 0 && serial.length < 128 && serialRegex.test(serial);
  }

  /**
   * Validates a safe 6-digit wireless debugging pairing PIN
   */
  static isValidPairingCode(pin: string): boolean {
    return /^\d{6}$/.test(pin.trim());
  }

  /**
   * Sanitizes and resolves an output file path within a safe base directory
   */
  static resolveSafePath(baseDir: string, userFilename: string): string {
    const safeName = path.basename(userFilename).replace(/[^a-zA-Z0-9._-]/g, '_');
    return path.resolve(baseDir, safeName);
  }

  /**
   * Redacts sensitive personal identifiers, tokens, and credentials from log strings
   */
  static redactSensitiveText(rawText: string): string {
    return rawText
      // Redact email addresses
      .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '[REDACTED_EMAIL]')
      // Redact bearer tokens or API keys
      .replace(/(bearer\s+[a-zA-Z0-9._~+/-]+=*)/gi, 'Bearer [REDACTED_TOKEN]')
      // Redact 6-digit pairing codes
      .replace(/\b\d{6}\b/g, '[REDACTED_PIN]');
  }

  /**
   * Validates coordinate values (integer, non-negative, and strictly within optional screen bounds)
   */
  static isValidCoordinate(val: number, max?: number): boolean {
    if (typeof val !== 'number' || !Number.isInteger(val) || val < 0) {
      return false;
    }
    if (max !== undefined && val >= max) {
      return false;
    }
    return true;
  }

  /**
   * Validates duration for swipe operations (50ms - 10000ms)
   */
  static isValidSwipeDuration(ms: number): boolean {
    return typeof ms === 'number' && Number.isInteger(ms) && ms >= 50 && ms <= 10000;
  }

  /**
   * Validates Android keycode (0 - 300)
   */
  static isValidKeyCode(code: number): boolean {
    return typeof code === 'number' && Number.isInteger(code) && code >= 0 && code <= 300;
  }

  /**
   * Validates and encodes input text for safe ADB injection.
   * Prevents shell metacharacter injection and rejects non-ASCII Unicode to avoid silent corruption.
   */
  static sanitizeInputText(rawText: string): { valid: boolean; encoded?: string; error?: string } {
    if (typeof rawText !== 'string' || rawText.length === 0) {
      return { valid: false, error: 'Input text cannot be empty.' };
    }

    if (rawText.length > 500) {
      return { valid: false, error: 'Input text exceeds maximum length of 500 characters.' };
    }

    // Disallow dangerous shell metacharacters that adbd /system/bin/sh evaluates
    const dangerousShellChars = /[;&|`$<>(){}[\]\\"]/;
    const dangerousMatch = rawText.match(dangerousShellChars);
    if (dangerousMatch) {
      return {
        valid: false,
        error: `Disallowed character '${dangerousMatch[0]}' in text input: Shell metacharacters are rejected to prevent command injection.`
      };
    }

    // Check for control characters or Unicode > 127
    for (let i = 0; i < rawText.length; i++) {
      const code = rawText.charCodeAt(i);
      if (code < 32 || code === 127) {
        return {
          valid: false,
          error: `Control character (code ${code}) is not supported by ADB input text.`
        };
      }
      if (code > 127) {
        const char = rawText[i];
        const hex = code.toString(16).toUpperCase().padStart(4, '0');
        return {
          valid: false,
          error: `Unsupported Unicode character '${char}' (U+${hex}): Android ADB input text only supports ASCII characters (32-126). Use clipboard or an IME for non-ASCII text.`
        };
      }
    }

    // Encode spaces as %s for Android input tool
    const encoded = rawText.replace(/ /g, '%s');
    return { valid: true, encoded };
  }
}
