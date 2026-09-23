import { assertSafeUrl } from '../security/ssrf.js';
import { loadConfig } from '../config.js';
import { ProxyAgent } from 'undici';

export async function safeFetch(
  url: string,
  init?: RequestInit,
  options?: { proxy?: string; allowPrivateOrigin?: string; maxRedirects?: number; signal?: AbortSignal }
): Promise<Response> {
  const maxRedirects = options?.maxRedirects ?? 5;
  let currentUrl = url;
  let currentMethod = init?.method ?? 'GET';
  let currentBody = init?.body;
  let redirects = 0;

  const dispatcher = options?.proxy ? new ProxyAgent(options.proxy) : undefined;

  while (redirects <= maxRedirects) {
    await assertSafeUrl(currentUrl, { allowUrl: options?.allowPrivateOrigin });

    const fetchInit: RequestInit = {
      ...init,
      method: currentMethod,
      body: currentBody ?? null,
      redirect: 'manual',
      signal: AbortSignal.any([
        options?.signal ?? new AbortController().signal,
        AbortSignal.timeout(15_000),
      ] as AbortSignal[]),
      // @ts-ignore
      dispatcher: dispatcher as any,
    };
    if (currentBody === undefined) delete fetchInit.body;

    const response = await fetch(currentUrl, fetchInit as any);
  if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) throw new Error('Redirect without location header');

      const nextUrl = new URL(location, currentUrl);

      // Handle Cross-Origin
      if (nextUrl.origin !== new URL(currentUrl).origin) {
        // Need to update the init object's headers
        const headers = new Headers(init?.headers);
        headers.delete('authorization');
        headers.delete('x-subscription-token');
        headers.delete('cookie');
        init = { ...init, headers };

        if (currentMethod !== 'GET') {
            currentMethod = 'GET';
            currentBody = undefined;
        }
      }

      currentUrl = nextUrl.toString();
      redirects++;
      continue;
    }

    return response;
  }

  throw new Error('Too many redirects');
}
