import { describe, it, expect, vi, beforeEach } from 'vitest';
import { safeFetch } from './fetch.js';
import * as ssrf from '../security/ssrf.js';

vi.mock('../security/ssrf.js');

describe('safeFetch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(ssrf.assertSafeUrl).mockResolvedValue(undefined);
    // Mock global fetch
    vi.stubGlobal('fetch', vi.fn());
  });

  it('validates URL and calls fetch', async () => {
    vi.mocked(fetch).mockResolvedValue({
      status: 200,
      headers: new Headers(),
    } as any);

    await safeFetch('http://example.com');

    expect(ssrf.assertSafeUrl).toHaveBeenCalledWith('http://example.com');
    expect(fetch).toHaveBeenCalled();
  });

  it('handles redirects', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce({
        status: 302,
        headers: new Headers({ location: 'http://redirected.com' }),
      } as any)
      .mockResolvedValueOnce({
        status: 200,
        headers: new Headers(),
      } as any);

    await safeFetch('http://example.com');

    expect(ssrf.assertSafeUrl).toHaveBeenCalledTimes(2);
    expect(ssrf.assertSafeUrl).toHaveBeenNthCalledWith(2, 'http://redirected.com/');
  });

  it('throws on too many redirects', async () => {
    vi.mocked(fetch).mockResolvedValue({
      status: 302,
      headers: new Headers({ location: 'http://loop.com' }),
    } as any);

    await expect(safeFetch('http://example.com', undefined, { maxRedirects: 2 })).rejects.toThrow('Too many redirects');
  });
});
