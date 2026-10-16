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
}
