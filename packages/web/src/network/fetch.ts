import { assertSafeUrl } from '../security/ssrf';
import { loadConfig } from '../config';

export async function safeFetch(
  url: string,
  init?: RequestInit,
  options?: { proxy?: string; maxRedirects?: number }
): Promise<Response> {
  const config = loadConfig();
  const maxRedirects = options?.maxRedirects ?? 5;
  let currentUrl = url;
  let redirects = 0;

  while (redirects <= maxRedirects) {
    await assertSafeUrl(currentUrl);

    const proxy = options?.proxy ?? config.proxy;
    const fetchOptions: RequestInit = {
      ...init,
      redirect: 'manual',
    };

    // Note: Node's native fetch doesn't directly support `proxy` option in RequestInit
    // but in a real system we'd use a custom agent. Keeping it simple as per spec.

    const response = await fetch(currentUrl, fetchOptions);

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) throw new Error('Redirect without location header');
      
      currentUrl = new URL(location, currentUrl).toString();
      redirects++;
      continue;
    }

    return response;
  }

  throw new Error('Too many redirects');
}
