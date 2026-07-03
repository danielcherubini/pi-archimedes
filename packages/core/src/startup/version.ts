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

/**
 * Compare two semver version strings.
 * Strips leading `v` prefix. Compares major, minor, patch numerically.
 * Ignores prerelease and build metadata (e.g., "1.2.3-beta" compares equal to "1.2.3").
 * @param a - First version string (e.g., "1.2.3" or "v1.2.3")
 * @param b - Second version string
 * @returns Positive if `a` > `b`, negative if `a` < `b`, 0 if equal.
 */
export function compareVersions(a: string, b: string): number {
  const pa = a.replace(/^v/, "").split(".").map(Number);
  const pb = b.replace(/^v/, "").split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) > (pb[i] ?? 0)) return 1;
    if ((pa[i] ?? 0) < (pb[i] ?? 0)) return -1;
  }
  return 0;
}
