import dns from 'dns';
import { promisify } from 'util';

const lookup = promisify(dns.lookup);

export function isPrivateIp(ip: string): boolean {
  // IPv4 private blocks
  if (/^(127\.|10\.|192\.168\.|169\.254\.)/.test(ip)) return true;
  if (/^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(ip)) return true;

  // IPv6 private/special blocks
  if (ip === '::1') return true;
  if (ip.startsWith('fe80:')) return true;
  if (ip.startsWith('fc00:')) return true;
  if (ip.startsWith('fd00:')) return true;

  return false;
}

export async function assertSafeUrl(urlString: string): Promise<void> {
  const url = new URL(urlString);
  const hostname = url.hostname;

  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    throw new Error('SSRF protection: access to private network address blocked');
  }

  const result = await lookup(hostname, { all: true });
  for (const entry of result) {
    if (isPrivateIp(entry.address)) {
      throw new Error('SSRF protection: access to private network address blocked');
    }
  }
}
