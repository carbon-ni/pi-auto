# pi-auto

Pi extension that adds `/auto`.

## Usage

```text
/auto 3
```

Repeats the previous user message three times. Each message is sent only after the previous agent turn ends.

```text
/auto 3 keep going
```

Overrides the previous-message behavior and sends `keep going` three times, waiting for idle between sends.

```text
/auto-edit keep going with this instead
```

Changes the message for a running auto mode. Future sends use the edited message.

## Install locally

From this repo:

```bash
pi -e ./src/index.ts
```

Or auto-discover it:

```bash
mkdir -p ~/.pi/agent/extensions/pi-auto
ln -sf "$PWD/src/index.ts" ~/.pi/agent/extensions/pi-auto/index.ts
```

Then restart Pi or run `/reload`.
