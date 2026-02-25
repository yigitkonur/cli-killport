# cli-killport

Kill any process occupying a port. Unix-first, zero-zombie, one command.

```
  █ ▄█ █▀█  █  █ █  █ █▀▀█ █▀▀█ █▀▀▄ ▀██▀
  ██▀  █ █  █  █ █  █ █▀▀  █ █ ██▀   ██
  █ ▀█ ▀ ▀  ▀▀▀▀ ▀▀▀▀ █    ▀▀▀▀ █ ▀█  ▀▀
```

## Install

```bash
# Use directly with npx (no install needed)
npx cli-killport 1420

# Or install globally
npm i -g cli-killport
killport 1420

# Short alias
kp 1420
```

## What it does

1. Finds every process bound to the given port (`lsof`, `fuser`, `ss`)
2. Shows you what it found — PID, name, user, command, state, children
3. Kills the entire process tree bottom-up (children first → parent last)
4. Sends `SIGTERM` → brief grace → `SIGKILL` (-9) → kills process group
5. Reaps zombie children by signaling parent processes
6. Verifies the port is actually free before exiting

## Usage

```bash
killport <port> [options]
```

### Options

| Flag | Description |
|------|-------------|
| `-h, --help` | Show help |
| `-v, --version` | Show version |
| `-s, --silent` | Suppress banner and verbose output |

### Examples

```bash
killport 1420     # Kill whatever is on port 1420
killport 3000     # Free up port 3000
kp 5173           # Short alias
npx cli-killport 8080  # No install needed
```

## Platforms

- **macOS** — first-class support via `lsof`
- **Linux** — `lsof` → `fuser` → `ss` fallback chain

## Why

Because `lsof -i :1420 | awk '{print $2}' | tail -1 | xargs kill -9` is not a real workflow. And it leaves zombie children behind.

## License

MIT
