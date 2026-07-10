# QMK notifier settings

The Pi QMK notifier package reads `qmk-notifier.settings.json` on each notification attempt.

Key fields:

- `enabled` (bool)
  - Master on/off switch.
- `pythonExe` (string, optional)
  - Overrides the platform launcher (`py` on Windows, `python3` on macOS/Linux).
- `pythonArgs` (array of strings, optional)
  - Arguments inserted before the script path. The Windows platform default is `["-3"]`; macOS/Linux default to `[]`. An explicit `[]` clears launcher arguments.
- `timeoutMs` (int, 300-30000)
  - Per-command timeout for sender execution.
- `cooldownMs` (int, 500-120000)
  - Minimum delay between notifications for the same session.
- `staleMs` (int, 5000-600000)
  - Reserved for parity with the earlier notifier configuration.
- `dryRun` (bool)
  - If true, command payloads are validated without sending to keyboard.

Device selection (`device` object):

- `vid` / `pid`
- `usagePage` / `usage`

Profiles (`profiles` object):

- `normal`
- `question`
- `messageError`
- `sessionError`

Each profile supports:

- `hue` (0-255)
- `sat` (0-255)
- `val` (0-255)
- `durationMs` (100-5000)

## Python selection and overrides

Python configuration is resolved in this order:

1. `PI_QMK_NOTIFY_PYTHON_EXE` and `PI_QMK_NOTIFY_PYTHON_ARGS`
2. `pythonExe` and `pythonArgs` in `qmk-notifier.settings.json`
3. Platform defaults: `py -3` on Windows, or `python3` with no launcher arguments on macOS/Linux

`PI_QMK_NOTIFY_PYTHON_ARGS` must be a JSON array, for example `["-I"]`. Use `[]` to explicitly pass no launcher arguments. Settings also accept an explicit empty `pythonArgs` array.

Executable overrides do not inherit argument lists from a lower-precedence source. For example, setting only `PI_QMK_NOTIFY_PYTHON_EXE=python` on Windows uses `python` with `[]`, not `python -3`. To pair a custom executable with arguments, override both values at the same level.

## Setup and validation

Windows:

```powershell
py -3 -m pip install --user hidapi
py -3 scripts/qmk-led-notify.py --list
py -3 scripts/qmk-led-notify.py --ping
py -3 scripts/qmk-led-notify.py --flash --reason manual-test
```

macOS (dedicated virtual environment):

```bash
python3 -m venv "$HOME/.local/share/pi-qmk-led-notifier/venv"
QMK_PYTHON="$HOME/.local/share/pi-qmk-led-notifier/venv/bin/python"
"$QMK_PYTHON" -m pip install hidapi
"$QMK_PYTHON" scripts/qmk-led-notify.py --list
"$QMK_PYTHON" scripts/qmk-led-notify.py --ping
"$QMK_PYTHON" scripts/qmk-led-notify.py --flash --reason manual-test
export PI_QMK_NOTIFY_PYTHON_EXE="$QMK_PYTHON"
```

Persist `PI_QMK_NOTIFY_PYTHON_EXE` in the shell configuration used to launch Pi.
