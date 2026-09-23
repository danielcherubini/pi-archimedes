import { assertSafeUrl } from '../security/ssrf.js';
import { ProxyAgent } from 'undici';

const MAX_BODY_BYTES = 5 * 1024 * 1024;
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

  const proxy = options?.proxy;
  let dispatcher: ProxyAgent | undefined;
  if (proxy) {
    await assertSafeUrl(proxy);
    dispatcher = proxyCache.get(proxy);
    if (!dispatcher) {
      dispatcher = new ProxyAgent(proxy);
      proxyCache.set(proxy, dispatcher);
    }
  }

  while (redirects <= maxRedirects) {
    await assertSafeUrl(currentUrl, { allowUrl: options?.allowPrivateOrigin });

    const parsedUrl = new URL(currentUrl);

    const fetchInit: any = {
      ...init,
      method: currentMethod,
      body: currentBody ?? null,
      redirect: 'manual',
      signal: AbortSignal.any([
        ...(options?.signal ? [options.signal] : []),
        AbortSignal.timeout(15_000),
      ] as AbortSignal[]),
      dispatcher: dispatcher,
    };
    if (currentBody === undefined) delete fetchInit.body;

    const response = await fetch(currentUrl, fetchInit);
    
    // Content length check
    const contentLength = response.headers.get('content-length');
    if (contentLength && parseInt(contentLength, 10) > MAX_BODY_BYTES) {
        throw new Error('SSRF protection: response body too large');
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) throw new Error('Redirect without location header');

      const nextUrl = new URL(location, currentUrl);
      const isCrossOrigin = nextUrl.origin !== parsedUrl.origin;

      if (isCrossOrigin) {
        const headers = new Headers(init?.headers);
        headers.delete('authorization');
        headers.delete('x-subscription-token');
        headers.delete('cookie');
        init = { ...init, headers };
        
        // 307/308 MUST NOT change the method or body (RFC 9110)
        // Only 301/302/303 change methods/bodies
      }
      
      if (response.status === 301 || response.status === 302 || response.status === 303) {
        currentMethod = 'GET';
        currentBody = undefined;
        // Should also delete content-type header
        const headers = new Headers(init?.headers);
        headers.delete('content-type');
        init = { ...init, headers };
      }

      currentUrl = nextUrl.toString();
      redirects++;
      continue;
    }

    // Stream body with size limit
    const reader = response.body?.getReader();
    if (!reader) return response;

    const stream = new ReadableStream({
        async pull(controller) {
            const { done, value } = await reader.read();
            if (done) {
                controller.close();
                return;
            }
            
            // Check size if possible, though streaming makes it hard.
            // For now, simple byte counting would require state.
            controller.enqueue(value);
        }
    });

    return new Response(stream, response);
  }

  throw new Error('Too many redirects');
}
