/**
 * In-memory credential cache for sudo_exec (ADR 0010).
 *
 * A single credential at a time, kept ONLY in memory for the active session —
 * never written to disk or the OS keyring. Expired entries return null from
 * get() (triggering a re-prompt) but are not auto-cleared; clear() is called
 * on session_shutdown, /sudo forget, and auth failure to drop the password
 * from memory entirely. No host/user keying in v1.
 */
export interface CachedCredential {
	password: string;
	expiresAt: number;
	/**
	 * Consecutive ambiguous command failures (non-terminal credential probe
	 * after an unrecognized-signature failure) under THIS entry. The tool's
	 * two-strike rule bumps/resets it; a fresh set() restarts it at 0.
	 */
	failStreak: number;
}

export class CredentialCache {
	private entry: CachedCredential | null = null;

	/** Set (or replace) the cached credential with a fresh TTL (and a zeroed fail streak). */
	set(password: string, ttlMs: number): void {
		this.entry = { password, expiresAt: Date.now() + ttlMs, failStreak: 0 };
	}

	/** Return the cached credential, or null if unset or expired. */
	get(): CachedCredential | null {
		if (this.entry === null) return null;
		if (Date.now() >= this.entry.expiresAt) return null;
		return this.entry;
	}

	/** Drop the credential from memory entirely. */
	clear(): void {
		this.entry = null;
	}

	/** Bump the current entry's failStreak (no-op when the cache is empty). */
	bumpFailStreak(): void {
		if (this.entry !== null) this.entry.failStreak += 1;
	}

	/** Reset the current entry's failStreak (no-op when the cache is empty). */
	resetFailStreak(): void {
		if (this.entry !== null) this.entry.failStreak = 0;
	}

	/** True when an entry is present but past its expiry. */
	get isExpired(): boolean {
		return this.entry !== null && Date.now() >= this.entry.expiresAt;
	}
}

/** Module-level singleton, recreated per session via clear() on session_start (Task 3 lifecycle). */
export const credentialCache = new CredentialCache();
