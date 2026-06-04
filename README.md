# pi-archimedes

Visual polish and useful context for the [Pi](https://github.com/earendil-works/pi) coding agent TUI. An npm workspaces monorepo that splits the original `pi-ui-hephaestus` into independent, installable packages.

## Packages

| Package | Description |
|---------|-------------|
| [`@pi-archimedes/core`](packages/core) | Core UI modules: editor, message, startup, thinking, bus, chrome, text/color utilities |
| [`@pi-archimedes/footer`](packages/footer) | Rich footer status bar with git status, model info, token usage, and cost tracking |
| [`@pi-archimedes/diff`](packages/diff) | Shiki-powered syntax-highlighted diff rendering |
| [`@pi-archimedes/image-paste`](packages/image-paste) | Clipboard image paste, preview rendering, and marker-based attachment |
| [`pi-archimedes`](meta) | Meta-package — depends on all four above for one-line install |

## Installation

```bash
# Install the meta-package (includes all components)
pi install pi-archimedes

# Or install individual packages
pi install @pi-archimedes/core
pi install @pi-archimedes/footer
pi install @pi-archimedes/diff
pi install @pi-archimedes/image-paste
```

## Development

```bash
npm install          # Install workspace dependencies
npm ls               # Verify workspace structure
```

Each package extends the root `tsconfig.json`. Verify TypeScript compiles with:

```bash
cd packages/<name> && npx tsc --noEmit
```

## Architecture

- **TypeScript (ESM)** — loaded via jiti by Pi, no build step
- **npm workspaces** — packages reference each other via workspace protocol
- **Import paths:** relative within a package, package subpath exports across packages (e.g., `@pi-archimedes/core/bus`)
- **Config:** each package reads its own namespace from `~/.pi/agent/settings.json` under `archimedes.*`
