import { assertSafeUrl } from '../security/ssrf.js';
import { loadConfig } from '../config.js';

export async function safeFetch(
  url: string,
  init?: RequestInit,
  options?: { proxy?: string; maxRedirects?: number; allowPrivateOrigin?: string; timeout?: number }
): Promise<Response> {
  const config = loadConfig();
  const maxRedirects = options?.maxRedirects ?? 5;
  const timeout = options?.timeout ?? 15000;
  let currentUrl = url;
  let currentMethod = init?.method ?? 'GET';
  let currentBody = init?.body;
  let redirects = 0;

  while (redirects <= maxRedirects) {
    await assertSafeUrl(currentUrl, { allowUrl: options?.allowPrivateOrigin });

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const headers = new Headers(init?.headers);

    const response = await fetch(currentUrl, {
      ...init,
      method: currentMethod,
      body: currentBody,
      headers,
      redirect: 'manual',
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) throw new Error('Redirect without location header');

      const nextUrl = new URL(location, currentUrl);

      // Handle Cross-Origin
      if (nextUrl.origin !== new URL(currentUrl).origin) {
        headers.delete('authorization');
        headers.delete('x-subscription-token');
        headers.delete('cookie');

        if ((response.status === 301 || response.status === 302 || response.status === 303) && currentMethod === 'POST') {
          currentMethod = 'GET';
          currentBody = undefined;
        }
      }

      currentUrl = nextUrl.toString();
      redirects++;
      continue;
    }

    // Byte limit handling (streaming)
    // Note: This requires Node.js environment or specific browser fetch impl
    // For simplicity, we assume we return the response and caller handles streaming
    return response;
  }

  throw new Error('Too many redirects');
}
