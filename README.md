# Pi QMK LED Notifier

Pi package that flashes a configured QMK RAW HID keyboard notification profile when Pi finishes a reply.

## Behavior

The notifier classifies reply completion into broad categories:

- normal reply
- likely question / input-needed reply
- reply with tool error
- reply with assistant/session error

It then runs the bundled `scripts/qmk-led-notify.py` helper using the configured color/duration profile.

## Files

- `extensions/qmk-led-notifier.ts`
- `qmk-notifier.settings.json`
- `qmk-notifier.settings.md`
- `scripts/qmk-led-notify.py`

## Configuration

Preferred environment variables:

- `PI_QMK_NOTIFY_ENABLED`
- `PI_QMK_NOTIFY_DRY_RUN`
- `PI_QMK_NOTIFY_TIMEOUT_MS`

Legacy compatibility variables are also accepted:

- `OC_QMK_NOTIFY_ENABLED`
- `OC_QMK_NOTIFY_DRY_RUN`
- `OC_QMK_NOTIFY_TIMEOUT_MS`

See `qmk-notifier.settings.md` for settings-file details.

## Install

Recommended as a global package.

From GitHub:

```bash
pi install git:git@github.com:aefreedman/pi-qmk-led-notifier.git
```

Local development install:

```bash
pi install <path-to-pi-qmk-led-notifier>
```

## Requirements

- A QMK keyboard/firmware setup that supports the bundled RAW HID notifier workflow
- Python available for `scripts/qmk-led-notify.py`

## License

MIT. See `LICENSE`.
