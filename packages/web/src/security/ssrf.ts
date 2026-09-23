import dns from 'dns';
import { isIP, isIPv4, isIPv6 } from 'net';

export function isPrivateIp(ip: string): boolean {
  if (!isIP(ip)) return false;

  // IPv4 handling
  if (isIPv4(ip)) {
    // 0.0.0.0/8 (0.0.0.0/0 included in /8 check if strictly interpreted)
    if (ip.startsWith('0.')) return true;
    // 127.0.0.0/8
    if (ip.startsWith('127.')) return true;
    // 10.0.0.0/8
    if (ip.startsWith('10.')) return true;
    // 172.16.0.0/12
    const parts = ip.split('.');
    const first = parts[0] ? parseInt(parts[0], 10) : NaN;
    const second = parts[1] ? parseInt(parts[1], 10) : NaN;
    if (first === 172 && second >= 16 && second <= 31) return true;
    // 192.168.0.0/16
    if (ip.startsWith('192.168.')) return true;
    // 169.254.0.0/16
    if (ip.startsWith('169.254.')) return true;
    return false;
  }

  // IPv6 handling
  // Strip IPv4-mapped IPv6 (::ffff:127.0.0.1)
  if (ip.startsWith('::ffff:')) {
    const ipv4 = ip.substring(7);
    return isPrivateIp(ipv4);
  }

  // ::, ::1
  if (ip === '::' || ip === '::1') return true;
  // fe80::/10
  if (ip.toLowerCase().startsWith('fe8')) {
    // Check if within fe80::/10 (fe80 to febf)
    const firstPartStr = ip.split(':')[0];
    const firstPart = firstPartStr ? parseInt(firstPartStr, 16) : NaN;
    if (!isNaN(firstPart) && firstPart >= 0xfe80 && firstPart <= 0xfebf) return true;
  }
  // fc00::/7
  if (ip.toLowerCase().startsWith('fc') || ip.toLowerCase().startsWith('fd')) return true;

  return false;
}

export async function assertSafeUrl(urlString: string): Promise<void> {
  const url = new URL(urlString);
  const hostname = url.hostname;

  if (hostname.toLowerCase() === 'localhost' || hostname === '127.0.0.1' || hostname === '0.0.0.0' || hostname === '[::]') {
    throw new Error('SSRF protection: access to private network address blocked');
  }

  const result = await dns.promises.lookup(hostname, { all: true });
  for (const entry of (Array.isArray(result) ? result : [result]) as dns.LookupAddress[]) {
    if (isPrivateIp(entry.address)) {
      throw new Error('SSRF protection: access to private network address blocked');
    }
  }
}
