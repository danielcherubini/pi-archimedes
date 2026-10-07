import { describe, it, expect, vi, afterEach } from "vitest";
import * as fc from "fast-check";

// ── Type alias ──────────────────────────────────────────────────────────────

interface GitStatus {
  staged: number;
  unstaged: number;
  untracked: number;
  ahead: number;
  behind: number;
}

// ── Tests (vi.resetModules + dynamic import to isolate module state) ────────

describe("getGitStatus", () => {
  let getGitStatus: () => GitStatus;
  let isInsideLinkedWorktree: () => boolean;

  async function loadModule(mockExecSync: ReturnType<typeof vi.fn>) {
    vi.resetModules();

    vi.doMock("child_process", () => ({
      execSync: mockExecSync,
    }));

    vi.doMock("fs", () => ({
      realpathSync: vi.fn((p: string) => p),
    }));

    const mod = await import("./git.js");
    getGitStatus = mod.getGitStatus;
    isInsideLinkedWorktree = mod.isInsideLinkedWorktree;
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("empty output returns zero status", async () => {
    const mockExecSync = vi.fn(() => "");
    await loadModule(mockExecSync);
    const result = getGitStatus();
    expect(result).toEqual({ staged: 0, unstaged: 0, untracked: 0, ahead: 0, behind: 0 });
  });

  it("parse scored format lines", async () => {
    const mockExecSync = vi.fn(() => "1 AM file1.txt\n1  M file2.txt\n");
    await loadModule(mockExecSync);
    const result = getGitStatus();
    // AM: index=A (staged), workTree=M (unstaged) → 1 staged, 1 unstaged
    // " M": index=space (not staged), workTree=M (unstaged) → 1 unstaged
    expect(result.staged).toBe(1);
    expect(result.unstaged).toBe(2);
  });

  it("parse unscored format lines (note: trim() strips leading space)", async () => {
    // TODO: parseGitOutput calls output.trim() which strips leading whitespace.
    // This means unscored lines like " M file.txt" (index=space, workTree=M,
    // meaning unstaged modification) become "M file.txt" after trim, and are
    // incorrectly parsed as index=M (staged), workTree=space.
    // This test codifies the current (buggy) behavior so future fixes to
    // remove trim() won't break silently — update both the implementation
    // and this test together when fixing.
    const mockExecSync = vi.fn(() => "M  file.txt\nA  staged.txt\n");
    await loadModule(mockExecSync);
    const result = getGitStatus();
    // "M ": index=M (staged), workTree=space → 1 staged
    // "A ": index=A (staged), workTree=space → 1 staged
    expect(result.staged).toBe(2);
    expect(result.unstaged).toBe(0);
  });

  it("parse untracked lines", async () => {
    const mockExecSync = vi.fn(() => "?  untracked1.txt\n?  untracked2.txt\n");
    await loadModule(mockExecSync);
    const result = getGitStatus();
    expect(result.untracked).toBe(2);
  });

  it("parse branch summary (ahead/behind)", async () => {
    const mockExecSync = vi.fn(() => "## main...origin/main 3 2\n");
    await loadModule(mockExecSync);
    const result = getGitStatus();
    expect(result.ahead).toBe(3);
    expect(result.behind).toBe(2);
  });

  it("malformed lines ignored gracefully", async () => {
    const mockExecSync = vi.fn(() => "this is not valid\n\n  \n1 AM valid.txt\n");
    await loadModule(mockExecSync);
    const result = getGitStatus();
    // Only the valid scored line should be parsed
    expect(result.staged).toBe(1);
    expect(result.unstaged).toBe(1);
  });

  it("isInsideLinkedWorktree returns false for a single (main) worktree", async () => {
    const mockExecSync = vi.fn(() => "head ref/heads/main\nworktree /path/to/repo\n");
    await loadModule(mockExecSync);
    expect(isInsideLinkedWorktree()).toBe(false);
  });

  it("isInsideLinkedWorktree returns false when cwd is the MAIN worktree", async () => {
    // cwd equals the first porcelain entry → main clone, not a linked worktree
    const cwd = process.cwd();
    const mockExecSync = vi.fn(() =>
      `worktree ${cwd}\nbranch refs/heads/main\n\n` + "worktree /home/x/wt-other\nbranch refs/heads/other\n");
    await loadModule(mockExecSync);
    expect(isInsideLinkedWorktree()).toBe(false);
  });

  it("isInsideLinkedWorktree returns true when cwd is a linked worktree", async () => {
    const cwd = process.cwd();
    const mockExecSync = vi.fn(() =>
      "worktree /nope/main\nbranch refs/heads/other\n\n" +
      `worktree ${cwd}\n` + "branch refs/heads/feature/x\n");
    await loadModule(mockExecSync);
    expect(isInsideLinkedWorktree()).toBe(true);
  });

  it("isInsideLinkedWorktree returns true for a detached-HEAD linked worktree", async () => {
    const cwd = process.cwd();
    const mockExecSync = vi.fn(() =>
      "worktree /nope/main\nbranch ref/heads/other\n\n" + `worktree ${cwd}\n` + "detached\n");
    await loadModule(mockExecSync);
    expect(isInsideLinkedWorktree()).toBe(true);
  });

  it("property: getGitStatus never throws (catches execSync errors gracefully)", async () => {
    const mockExecSync = vi.fn(() => { throw new Error("git not found"); });
    await loadModule(mockExecSync);
    expect(() => getGitStatus()).not.toThrow();
    const result = getGitStatus();
    expect(result).toEqual({ staged: 0, unstaged: 0, untracked: 0, ahead: 0, behind: 0 });
  });

  it("property: parseGitOutput handles arbitrary git porcelain output without throwing", async () => {
    await fc.assert(
      fc.asyncProperty(fc.string({ maxLength: 500 }), async (output) => {
        const mockExecSync = vi.fn(() => output);
        await loadModule(mockExecSync);
        expect(() => getGitStatus()).not.toThrow();
      }),
      { verbose: false },
    );
  });
});

// ── getGitBranch (jj-aware) ───────────────────────────────────────────────
//
// In a jj workspace, git reports "detached" (colocated: .git/HEAD points at a
// raw SHA; non-colocated: no .git at all). The branch section must fall back
// to the jj working-copy bookmark (or short change id when not on a bookmark).

describe("getGitBranch (jj-aware)", () => {
  let getGitBranch: () => string | null;
  let isJjWorkspace: (dir?: string) => boolean;

  interface SpawnResult { status: number; stdout: string; stderr: string }

  async function loadModuleJj(
    opts: {
      execSync?: ReturnType<typeof vi.fn>;
      spawnSync?: ReturnType<typeof vi.fn>;
      existsSync?: ReturnType<typeof vi.fn>;
    },
  ) {
    vi.resetModules();

    const execSync = opts.execSync ?? vi.fn(() => { throw new Error("git not found"); });
    const spawnSync = opts.spawnSync ?? vi.fn(() => ({ status: 1, stdout: "", stderr: "" } as SpawnResult));
    const existsSync = opts.existsSync ?? vi.fn(() => false);

    vi.doMock("child_process", () => ({ execSync, spawnSync }));
    vi.doMock("fs", () => ({ realpathSync: vi.fn((p: string) => p), existsSync }));

    const mod = await import("./git.js");
    getGitBranch = mod.getGitBranch;
    isJjWorkspace = mod.isJjWorkspace;
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Mock helper: spawnSync keyed by argv ("git --no-..." vs "jj log ...")
  function gitSpawn(git: SpawnResult, jj?: SpawnResult): ReturnType<typeof vi.fn> {
    return vi.fn((cmd: string, args: string[]) => {
      if (cmd === "git") return git;
      if (cmd === "jj") return jj ?? { status: 1, stdout: "", stderr: "error: not a workspace" };
      return { status: 1, stdout: "", stderr: "" };
    });
  }

  it("returns the jj bookmark in a jj workspace (git reports detached)", async () => {
    await loadModuleJj({
      spawnSync: gitSpawn({ status: 1, stdout: "", stderr: "" }, { status: 0, stdout: "my-feature\n", stderr: "" }),
      existsSync: vi.fn((p: string) => p.endsWith("/.jj")),
    });
    expect(getGitBranch()).toBe("my-feature");
  });

  it("returns the short change id when the working copy is not on a bookmark", async () => {
    await loadModuleJj({
      spawnSync: gitSpawn({ status: 128, stdout: "", stderr: "fatal: not a git repository" }, { status: 0, stdout: "abc12345\n", stderr: "" }),
      existsSync: vi.fn((p: string) => p.endsWith("/.jj")),
    });
    expect(getGitBranch()).toBe("abc12345");
  });

  it("prefers the git branch in a plain git repo (no .jj)", async () => {
    await loadModuleJj({
      spawnSync: gitSpawn({ status: 0, stdout: "main\n", stderr: "" }),
      existsSync: vi.fn(() => false),
    });
    expect(getGitBranch()).toBe("main");
  });

  it("returns 'detached' for a plain git repo on a detached HEAD", async () => {
    await loadModuleJj({
      spawnSync: gitSpawn({ status: 1, stdout: "", stderr: "" }),
      existsSync: vi.fn(() => false),
    });
    expect(getGitBranch()).toBe("detached");
  });

  it("returns null when neither git nor jj is available", async () => {
    await loadModuleJj({
      spawnSync: gitSpawn({ status: 128, stdout: "", stderr: "fatal: not a git repository" }),
      existsSync: vi.fn(() => false),
    });
    expect(getGitBranch()).toBeNull();
  });

  it("falls back to git ('detached') when the jj workspace exists but the jj command fails", async () => {
    await loadModuleJj({
      spawnSync: gitSpawn({ status: 1, stdout: "", stderr: "" }, { status: 1, stdout: "", stderr: "error: not a jj workspace" }),
      existsSync: vi.fn((p: string) => p.endsWith("/.jj")),
    });
    expect(getGitBranch()).toBe("detached");
  });

  it("isJjWorkspace is true when .jj exists in cwd, false otherwise", async () => {
    const cwdJj = `${process.cwd()}/.jj`;
    await loadModuleJj({ existsSync: vi.fn((p: string) => p === cwdJj) });
    expect(isJjWorkspace(process.cwd())).toBe(true);
    expect(isJjWorkspace("/nope/repo")).toBe(false);
  });

  it("property: getGitBranch never throws (catches process errors gracefully)", async () => {
    await loadModuleJj({
      spawnSync: vi.fn(() => { throw new Error("spawnSync boom"); }),
      existsSync: vi.fn(() => { throw new Error("fs boom"); }),
    });
    expect(() => getGitBranch()).not.toThrow();
    expect(getGitBranch()).toBeNull();
  });
});
