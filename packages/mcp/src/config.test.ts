import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { McpConfig, ServerDef } from "./types.js";
import { DEFAULT_MCP_CONFIG } from "./types.js";
import {
  stripJsonComments,
  mergeServerDefs,
  resolveServerSettings,
  loadServerDefs,
  loadAllServerDefs,
  URL_BOUND_AUTH_FIELDS,
} from "./config.js";

const globalConfig: McpConfig = { ...DEFAULT_MCP_CONFIG };

const stdio = (extra: Record<string, unknown> = {}): ServerDef =>
  ({ type: "stdio", command: "node", ...extra }) as ServerDef;

const http = (extra: Record<string, unknown> = {}): ServerDef =>
  ({ type: "http", url: "http://example.com", ...extra }) as ServerDef;

describe("stripJsonComments", () => {
  it("parses JSON with // comments and trailing commas", () => {
    const raw = `{
      // top-level comment
      "mcpServers": {
        "a": { "command": "node" }, // stdio server
        "b": { "url": "http://x", "headers": { "X-Api": "k" } },
      },
    }`;
    const parsed = JSON.parse(stripJsonComments(raw));
    expect(parsed.mcpServers.a.command).toBe("node");
    expect(parsed.mcpServers.b.url).toBe("http://x");
    expect(parsed.mcpServers.b.headers).toEqual({ "X-Api": "k" });
  });

  it("does not strip // inside string literals", () => {
    const raw = `{ "url": "https://example.com/path", "args": ["a//b"] } // trailing comment`;
    const parsed = JSON.parse(stripJsonComments(raw));
    expect(parsed.url).toBe("https://example.com/path");
    expect(parsed.args).toEqual(["a//b"]);
  });

  it("strips block comments and keeps plain JSON unchanged", () => {
    const raw = `{ /* block\ncomment */ "a": 1 }`;
    const parsed = JSON.parse(stripJsonComments(raw));
    expect(parsed.a).toBe(1);
    const plain = `{"a": [1, 2, 3]}`;
    expect(stripJsonComments(plain)).toBe(plain);
  });
});

describe("URL_BOUND_AUTH_FIELDS", () => {
  it("covers auth, headers, and bearerTokenEnv", () => {
    expect([...URL_BOUND_AUTH_FIELDS].sort()).toEqual(["auth", "bearerTokenEnv", "headers"]);
  });
});

describe("mergeServerDefs", () => {
  it("higher layer overrides lower for the same server", () => {
    const merged = mergeServerDefs([
      { a: stdio({ command: "old" }) },
      { a: stdio({ command: "new" }) },
    ]);
    expect(merged.a).toMatchObject({ command: "new" });
  });

  it("merges field-level: unspecified fields are inherited from lower layers", () => {
    const merged = mergeServerDefs([
      { a: stdio({ command: "node", args: ["x.js"], env: { K: "v" } }) },
      { a: stdio({ command: "bun" }) },
    ]);
    expect(merged.a).toEqual({ type: "stdio", command: "bun", args: ["x.js"], env: { K: "v" } });
  });

  it("keeps a server present only in a lower layer", () => {
    const merged = mergeServerDefs([
      { low: stdio({ command: "node" }) },
      { high: stdio({ command: "bun" }) },
    ]);
    expect(merged.low).toMatchObject({ command: "node" });
    expect(merged.high).toMatchObject({ command: "bun" });
  });

  it("drops inherited auth/headers/bearerTokenEnv when a higher layer changes the url", () => {
    const merged = mergeServerDefs([
      {
        s: http({
          url: "http://old",
          auth: { token: "secret" },
          headers: { "X-Api": "k" },
          bearerTokenEnv: "TOKEN",
        }),
      },
      { s: http({ url: "http://new" }) },
    ]);
    const def = merged.s as ServerDef;
    expect(def).toMatchObject({ url: "http://new" });
    expect("auth" in def).toBe(false);
    expect("headers" in def).toBe(false);
    expect("bearerTokenEnv" in def).toBe(false);
  });

  it("keeps inherited auth fields when the url is unchanged", () => {
    const merged = mergeServerDefs([
      { s: http({ url: "http://same", auth: { token: "secret" }, headers: { "X-Api": "k" } }) },
      { s: http({ url: "http://same", directTools: true }) },
    ]);
    const def = merged.s as ServerDef;
    expect(def).toMatchObject({
      url: "http://same",
      directTools: true,
      auth: { token: "secret" },
      headers: { "X-Api": "k" },
    });
  });

  it("keeps inherited auth fields when the higher layer has no url", () => {
    const merged = mergeServerDefs([
      { s: http({ url: "http://same", bearerTokenEnv: "TOKEN" }) },
      { s: { type: "http", idleTimeout: 5 } as ServerDef }, // no url in this layer
    ]);
    expect(merged.s).toMatchObject({ url: "http://same", bearerTokenEnv: "TOKEN", idleTimeout: 5 });
  });

  it("keeps auth fields the higher layer specifies for the new url", () => {
    const merged = mergeServerDefs([
      { s: http({ url: "http://old", auth: { token: "old-secret" } }) },
      { s: http({ url: "http://new", auth: { token: "new-secret" } }) },
    ]);
    expect(merged.s).toMatchObject({ url: "http://new", auth: { token: "new-secret" } });
  });
});

describe("resolveServerSettings", () => {
  it("applies defaults when nothing is set per-server", () => {
    const s = resolveServerSettings(stdio(), globalConfig);
    expect(s.lifecycle).toBe("lazy");
    expect(s.idleTimeout).toBe(globalConfig.idleTimeout);
    expect(s.toolPrefix).toBe(globalConfig.toolPrefix);
    expect(s.directTools).toBe(globalConfig.directTools);
  });

  it("per-server idleTimeout wins over global", () => {
    const s = resolveServerSettings(stdio({ idleTimeout: 5 }), globalConfig);
    expect(s.idleTimeout).toBe(5);
  });

  it("per-server idleTimeout of 0 is honored (disables) rather than falling back to global", () => {
    const s = resolveServerSettings(stdio({ idleTimeout: 0 }), globalConfig);
    expect(s.idleTimeout).toBe(0);
  });

  it("global toolPrefix is used when per-server is absent, per-server wins when present", () => {
    expect(resolveServerSettings(stdio(), globalConfig).toolPrefix).toBe(globalConfig.toolPrefix);
    const custom: McpConfig = { ...globalConfig, toolPrefix: "mcp" };
    expect(resolveServerSettings(stdio(), custom).toolPrefix).toBe("mcp");
    expect(resolveServerSettings(stdio({ toolPrefix: "none" }), custom).toolPrefix).toBe("none");
  });

  it("per-server directTools wins over global", () => {
    expect(resolveServerSettings(stdio({ directTools: ["t1"] }), globalConfig).directTools).toEqual(["t1"]);
    expect(resolveServerSettings(stdio({ directTools: false }), globalConfig).directTools).toBe(false);
  });

  it("passes through includeTools/excludeTools/requestTimeoutMs/exposeResources/debug/protocolVersion", () => {
    const s = resolveServerSettings(
      stdio({
        includeTools: ["a"],
        excludeTools: ["b"],
        requestTimeoutMs: 5000,
        exposeResources: true,
        debug: true,
        protocolVersion: "2025-06-18",
      }),
      globalConfig,
    );
    expect(s.includeTools).toEqual(["a"]);
    expect(s.excludeTools).toEqual(["b"]);
    expect(s.requestTimeoutMs).toBe(5000);
    expect(s.exposeResources).toBe(true);
    expect(s.debug).toBe(true);
    expect(s.protocolVersion).toBe("2025-06-18");
  });

  it("omits passthrough fields when not set per-server", () => {
    const s = resolveServerSettings(stdio(), globalConfig);
    expect("includeTools" in s).toBe(false);
    expect("excludeTools" in s).toBe(false);
    expect("requestTimeoutMs" in s).toBe(false);
    expect("exposeResources" in s).toBe(false);
    expect("debug" in s).toBe(false);
    expect("protocolVersion" in s).toBe(false);
  });
});

describe("loadServerDefs (integration with temp dirs)", () => {
  let home: string;
  let agentDir: string;
  let wd: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "mcp-home-"));
    agentDir = mkdtempSync(join(tmpdir(), "mcp-agent-"));
    wd = mkdtempSync(join(tmpdir(), "mcp-wd-"));
  });

  afterEach(() => {
    for (const dir of [home, agentDir, wd]) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  const write = (dir: string, rel: string, content: string): void => {
    const p = join(dir, rel);
    mkdirSync(join(p, ".."), { recursive: true });
    writeFileSync(p, content);
  };

  it("loads all six precedence layers in order, with comments and url-binding applied", () => {
    // 1. ~/.config/mcp/mcp.json (lowest)
    write(
      home,
      join(".config", "mcp", "mcp.json"),
      JSON.stringify({
        mcpServers: {
          svc: { type: "http", url: "http://v1", auth: { token: "tok" } },
          onlyLow: { type: "stdio", command: "node" },
        },
      }),
    );
    // 2. ~/.agents/mcp.json — same url, adds a field (auth must survive)
    write(
      home,
      join(".agents", "mcp.json"),
      JSON.stringify({
        mcpServers: { svc: { type: "http", url: "http://v1", directTools: true } },
      }),
    );
    // 3. ~/.agents/mcp/mcp.json — url changes: inherited auth must be dropped
    write(
      home,
      join(".agents", "mcp", "mcp.json"),
      JSON.stringify({ mcpServers: { svc: { type: "http", url: "http://v2" } } }),
    );
    // 4. <agentDir>/mcp.json — with // comments and trailing commas
    write(
      agentDir,
      "mcp.json",
      `{
        // agent dir config
        "mcpServers": {
          "svc": { "type": "http", "url": "http://v2" }, // unchanged url
        },
      }`,
    );
    // 5. <cwd>/.mcp.json — adds a new server
    write(
      wd,
      ".mcp.json",
      JSON.stringify({ mcpServers: { local: { type: "stdio", command: "bun" } } }),
    );
    // 6. <cwd>/.pi/mcp.json (highest) — per-server setting override
    write(
      wd,
      join(".pi", "mcp.json"),
      JSON.stringify({ mcpServers: { svc: { type: "http", url: "http://v2", idleTimeout: 3 } } }),
    );

    const defs = loadServerDefs(wd, { homeDir: home, agentDir });

    const svc = defs["svc"];
    expect(svc).toMatchObject({ type: "http", url: "http://v2", directTools: true, idleTimeout: 3 });
    expect("auth" in (svc ?? {})).toBe(false);
    expect(defs["onlyLow"]).toMatchObject({ command: "node" });
    expect(defs["local"]).toMatchObject({ command: "bun" });
    expect(Object.keys(defs).sort()).toEqual(["local", "onlyLow", "svc"]);
  });

  it("excludes disabled servers and still honors disabled from a higher layer", () => {
    write(
      wd,
      ".mcp.json",
      JSON.stringify({
        mcpServers: {
          off: { type: "stdio", command: "node", disabled: true },
          on: { type: "stdio", command: "node" },
        },
      }),
    );
    write(
      home,
      join(".config", "mcp", "mcp.json"),
      JSON.stringify({ mcpServers: { off: { type: "stdio", command: "node" } } }),
    );
    const defs = loadServerDefs(wd, { homeDir: home, agentDir });
    expect("off" in defs).toBe(false);
    expect(defs["on"]).toMatchObject({ command: "node" });
  });

  it("loadAllServerDefs keeps disabled servers (flag intact) while loadServerDefs excludes them", () => {
    write(
      wd,
      ".mcp.json",
      JSON.stringify({
        mcpServers: {
          off: { type: "stdio", command: "node", disabled: true },
          on: { type: "stdio", command: "node" },
        },
      }),
    );
    write(
      home,
      join(".config", "mcp", "mcp.json"),
      JSON.stringify({ mcpServers: { off: { type: "stdio", command: "node" } } }),
    );
    const all = loadAllServerDefs(wd, { homeDir: home, agentDir });
    expect("off" in all).toBe(true);
    expect(all["off"]).toMatchObject({ command: "node", disabled: true });
    expect(all["on"]).toMatchObject({ command: "node" });
    const active = loadServerDefs(wd, { homeDir: home, agentDir });
    expect("off" in active).toBe(false);
    expect(active["on"]).toMatchObject({ command: "node" });
  });

  describe("auth-type warning", () => {
    let warnSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    });

    afterEach(() => {
      warnSpy.mockRestore();
    });

    it('does not warn for auth: "oauth" (string)', () => {
      write(
        wd,
        ".mcp.json",
        JSON.stringify({
          mcpServers: { svc: { type: "http", url: "http://x", auth: "oauth" } },
        }),
      );
      const defs = loadServerDefs(wd, { homeDir: home, agentDir });
      expect(defs["svc"]).toMatchObject({ url: "http://x", auth: "oauth" });
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it("does not warn for bearer { token }, an OAuth config, or a single known field", () => {
      write(
        wd,
        ".mcp.json",
        JSON.stringify({
          mcpServers: {
            bearer: { type: "http", url: "http://x", auth: { token: "tok" } },
            cfg: {
              type: "http",
              url: "http://y",
              auth: { grantType: "client_credentials", clientId: "fixed-client" },
            },
            single: { type: "http", url: "http://z", auth: { clientId: "fixed-client" } },
          },
        }),
      );
      const defs = loadServerDefs(wd, { homeDir: home, agentDir });
      expect(Object.keys(defs).sort()).toEqual(["bearer", "cfg", "single"]);
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it("warns (but keeps) servers whose auth object has no known fields, even with a non-string token", () => {
      write(
        wd,
        ".mcp.json",
        JSON.stringify({
          mcpServers: {
            garbage: { type: "http", url: "http://x", auth: { foo: 1 } },
            tokNum: { type: "http", url: "http://y", auth: { token: 5 } },
          },
        }),
      );
      const defs = loadServerDefs(wd, { homeDir: home, agentDir });
      expect(defs["garbage"]).toMatchObject({ url: "http://x" });
      expect(defs["tokNum"]).toMatchObject({ url: "http://y" });
      expect(warnSpy).toHaveBeenCalledTimes(2);
    });

    it("warns (but keeps) servers with unknown auth shapes (other strings, numbers)", () => {
      write(
        wd,
        ".mcp.json",
        JSON.stringify({
          mcpServers: {
            bad: { type: "http", url: "http://x", auth: "azure-ad" },
            num: { type: "http", url: "http://y", auth: 42 },
          },
        }),
      );
      const defs = loadServerDefs(wd, { homeDir: home, agentDir });
      expect(defs["bad"]).toMatchObject({ url: "http://x" });
      expect(defs["num"]).toMatchObject({ url: "http://y" });
      expect(warnSpy).toHaveBeenCalledTimes(2);
      expect(warnSpy.mock.calls.map((c) => c[0]).join("\n")).toContain("\"azure-ad\"");
    });
  });
});
