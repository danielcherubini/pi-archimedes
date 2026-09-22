const NPM_REGISTRY_URL = "https://registry.npmjs.org/@earendil-works/pi-coding-agent/latest";
const FETCH_TIMEOUT_MS = 4000;

export async function fetchLatestVersion(): Promise<string | undefined> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const res = await fetch(NPM_REGISTRY_URL, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) return undefined;
    const data = (await res.json()) as { version?: string };
    return data.version;
  } catch {
    return undefined;
  }
}

export function compareVersions(a: string, b: string): number {
  const pa = a.replace(/^v/, "").split(".").map(Number);
  const pb = b.replace(/^v/, "").split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) > (pb[i] ?? 0)) return 1;
    if ((pa[i] ?? 0) < (pb[i] ?? 0)) return -1;
  }
  return 0;
}
