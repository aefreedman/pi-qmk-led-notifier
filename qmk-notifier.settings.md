# QMK notifier settings

The Pi QMK notifier package reads `qmk-notifier.settings.json` on each notification attempt.

Key fields:

- `enabled` (bool)
  - Master on/off switch.
- `pythonExe` (string)
  - Python launcher command (`py` on Windows, `python3` on macOS/Linux).
- `pythonArgs` (array of strings)
  - Extra arguments before script path (Windows default uses `-3`).
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

Quick validation commands:

```bash
py -3 -m pip install --user hidapi
py -3 scripts/qmk-led-notify.py --list
py -3 scripts/qmk-led-notify.py --ping
py -3 scripts/qmk-led-notify.py --flash --reason manual-test
```
