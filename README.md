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
/auto edit 3 "keep going with this instead"
```

Changes the message and remaining count for a running auto mode.

Canceling the current agent run with Pi's interrupt key also stops the entire auto loop. The default interrupt key is `Escape`; custom bindings such as `Ctrl+Q` work too.

The agent can also stop the loop early by calling the `auto_stop` tool:

```text
/auto 10 continue and call auto_stop once you are done
```

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
