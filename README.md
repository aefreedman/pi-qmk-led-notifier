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
- `PI_QMK_NOTIFY_PYTHON_EXE`
- `PI_QMK_NOTIFY_PYTHON_ARGS` (a JSON array, such as `["-I"]` or `[]`)

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
- Python and the `hidapi` package

The notifier defaults to `py -3` on Windows and `python3` with no launcher arguments on macOS/Linux.

### Windows setup

```powershell
py -3 -m pip install --user hidapi
py -3 scripts/qmk-led-notify.py --list
```

### macOS setup

Install Python 3 if `python3` is not already available. A dedicated virtual environment avoids externally-managed Python restrictions:

```bash
python3 -m venv "$HOME/.local/share/pi-qmk-led-notifier/venv"
"$HOME/.local/share/pi-qmk-led-notifier/venv/bin/python" -m pip install hidapi
"$HOME/.local/share/pi-qmk-led-notifier/venv/bin/python" scripts/qmk-led-notify.py --list
export PI_QMK_NOTIFY_PYTHON_EXE="$HOME/.local/share/pi-qmk-led-notifier/venv/bin/python"
```

Persist the environment override in the shell configuration used to launch Pi. See `qmk-notifier.settings.md` for interpreter and launcher-argument details.

## License

MIT. See `LICENSE`.
