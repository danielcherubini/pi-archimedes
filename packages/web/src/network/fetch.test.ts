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

    expect(ssrf.assertSafeUrl).toHaveBeenCalledWith('http://example.com', expect.any(Object));
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
    expect(ssrf.assertSafeUrl).toHaveBeenNthCalledWith(2, 'http://redirected.com/', expect.any(Object));
  });

  it('strips sensitive headers and drops body on cross-origin redirect', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce({
        status: 302,
        headers: new Headers({ location: 'http://different-origin.com' }),
      } as any)
      .mockResolvedValueOnce({
        status: 200,
        headers: new Headers(),
      } as any);

    const headers = new Headers({
        authorization: 'secret',
        'x-subscription-token': 'token',
        cookie: 'cookie'
    });
    
    await safeFetch('http://example.com', { method: 'POST', body: 'data', headers });

    // Initial call
    expect(fetch).toHaveBeenCalledWith('http://example.com', expect.objectContaining({
        method: 'POST',
        body: 'data'
    }));

    // Redirect call
    expect(fetch).toHaveBeenCalledWith('http://different-origin.com/', expect.anything());
  });
});
