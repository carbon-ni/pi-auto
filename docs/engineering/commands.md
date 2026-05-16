# Commands

## Install

```bash
npm ci
```

## Develop

```bash
npm test -- --watch
```

## Quality gate

```bash
make all
```

Runs lint and tests. This is the local equivalent of CI.

## Individual checks

```bash
make lint
make test
```

## Run extension locally

```bash
pi -e ./src/index.ts
```

## Install extension for auto-discovery

```bash
mkdir -p ~/.pi/agent/extensions/pi-auto
ln -sf "$PWD/src/index.ts" ~/.pi/agent/extensions/pi-auto/index.ts
```

Then restart Pi or run `/reload`.
