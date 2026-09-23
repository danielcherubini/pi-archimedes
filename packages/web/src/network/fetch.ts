import { assertSafeUrl } from '../security/ssrf.js';
import { ProxyAgent } from 'undici';

const proxyCache = new Map<string, ProxyAgent>();

export async function safeFetch(
  url: string,
  init?: RequestInit,
  options?: { proxy?: string | undefined; allowPrivateOrigin?: string; maxRedirects?: number; signal?: AbortSignal | undefined }
): Promise<Response> {
  const maxRedirects = options?.maxRedirects ?? 5;
  let currentUrl = url;
  let currentMethod = init?.method ?? 'GET';
  let currentBody = init?.body;
  let redirects = 0;

  let dispatcher: ProxyAgent | undefined;
  if (options?.proxy) {
    await assertSafeUrl(options.proxy);
    dispatcher = proxyCache.get(options.proxy);
    if (!dispatcher) {
      dispatcher = new ProxyAgent(options.proxy);
      proxyCache.set(options.proxy, dispatcher);
    }
  }

  while (redirects <= maxRedirects) {
    await assertSafeUrl(currentUrl, { allowUrl: options?.allowPrivateOrigin });

    const fetchInit: RequestInit = {
      ...init,
      method: currentMethod,
      body: currentBody ?? null,
      redirect: 'manual',
      signal: AbortSignal.any([
        ...(options?.signal ? [options.signal] : []),
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
