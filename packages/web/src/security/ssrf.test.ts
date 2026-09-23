import { describe, it, expect } from 'vitest';
import { isPrivateIp, assertSafeUrl } from './ssrf';

describe('SSRF Guard', () => {
  describe('isPrivateIp', () => {
    it('detects loopback addresses', () => {
      expect(isPrivateIp('127.0.0.1')).toBe(true);
      expect(isPrivateIp('::1')).toBe(true);
    });

    it('detects private networks', () => {
      expect(isPrivateIp('10.0.0.1')).toBe(true);
      expect(isPrivateIp('172.16.0.1')).toBe(true);
      expect(isPrivateIp('192.168.1.1')).toBe(true);
    });

    it('detects link-local / metadata addresses', () => {
      expect(isPrivateIp('169.254.169.254')).toBe(true);
      expect(isPrivateIp('fe80::1')).toBe(true);
    });

    it('detects IPv6 ULA', () => {
      expect(isPrivateIp('fc00::1')).toBe(true);
    });

    it('allows public IPs', () => {
      expect(isPrivateIp('8.8.8.8')).toBe(false);
      expect(isPrivateIp('2606:4700:4700::1111')).toBe(false);
    });
  });

  // Note: assertSafeUrl needs mocking or real network calls. 
  // We'll trust DNS lookup works as expected for integration.
});
