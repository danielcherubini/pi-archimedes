import { describe, it, expect, vi, beforeEach } from 'vitest';
import { isPrivateIp, assertSafeUrl } from './ssrf.js';
import dns from 'dns';

describe('SSRF Guard', () => {
  describe('isPrivateIp', () => {
    it('detects loopback addresses', () => {
      expect(isPrivateIp('127.0.0.1')).toBe(true);
      expect(isPrivateIp('127.255.255.255')).toBe(true);
      expect(isPrivateIp('::1')).toBe(true);
      expect(isPrivateIp('::')).toBe(true);
    });

    it('detects private networks', () => {
      expect(isPrivateIp('10.0.0.1')).toBe(true);
      expect(isPrivateIp('172.16.0.1')).toBe(true);
      expect(isPrivateIp('172.31.255.255')).toBe(true);
      expect(isPrivateIp('192.168.1.1')).toBe(true);
    });

    it('detects link-local / metadata addresses', () => {
      expect(isPrivateIp('169.254.169.254')).toBe(true);
      expect(isPrivateIp('fe80::1')).toBe(true);
    });

    it('detects IPv6 ULA', () => {
      expect(isPrivateIp('fc00::1')).toBe(true);
      expect(isPrivateIp('fd00::1')).toBe(true);
    });

    it('detects IPv4-mapped IPv6', () => {
        expect(isPrivateIp('::ffff:127.0.0.1')).toBe(true);
        expect(isPrivateIp('::ffff:10.0.0.1')).toBe(true);
        expect(isPrivateIp('::ffff:8.8.8.8')).toBe(false);
    });

    it('allows public IPs', () => {
      expect(isPrivateIp('8.8.8.8')).toBe(false);
      expect(isPrivateIp('2606:4700:4700::1111')).toBe(false);
    });
  });

  describe('assertSafeUrl', () => {
    beforeEach(() => {
        vi.spyOn(dns.promises, 'lookup').mockImplementation(async () => { return { address: '93.184.216.34', family: 4 } as dns.LookupAddress; });
    });

    it('throws for localhost', async () => {
      await expect(assertSafeUrl('http://localhost')).rejects.toThrow();
      await expect(assertSafeUrl('http://127.0.0.1')).rejects.toThrow();
    });

    it('throws for private network IPs via DNS', async () => {
      vi.spyOn(dns.promises, 'lookup').mockImplementation(async () => { return { address: '10.0.0.1', family: 4 } as dns.LookupAddress; });
      await expect(assertSafeUrl('http://some-private-host')).rejects.toThrow();
    });

    it('allows public URLs', async () => {
      await expect(assertSafeUrl('http://example.com')).resolves.not.toThrow();
    });
  });
});
