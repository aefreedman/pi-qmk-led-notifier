import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import {
  classifyReplyState,
  createReplyState,
  getEnvValue,
  getSessionKey,
  parseBoolean,
  parseIntBounded,
  parseNumberAutoBounded,
  parseStringArray,
  ReplyState,
  text,
  updateReplyStateFromMessage,
  updateReplyStateFromMessages,
} from "./shared/notifier-utils";
import { runProcess } from "./shared/process-utils";

const DEFAULT_SETTINGS_FILE_URL = new URL("../qmk-notifier.settings.json", import.meta.url);
const DEFAULT_SCRIPT_FILE_URL = new URL("../scripts/qmk-led-notify.py", import.meta.url);

interface NotifyProfile {
  hue: number;
  sat: number;
  val: number;
  durationMs: number;
}

interface RuntimeSettings {
  enabled: boolean;
  pythonExe: string;
  pythonArgs: string[];
  scriptPath: string;
  timeoutMs: number;
  cooldownMs: number;
  staleMs: number;
  dryRun: boolean;
  vid: number;
  pid: number;
  usagePage: number;
  usage: number;
  profiles: {
    normal: NotifyProfile;
    question: NotifyProfile;
    messageError: NotifyProfile;
    sessionError: NotifyProfile;
  };
}

const DEFAULT_SETTINGS: RuntimeSettings = {
  enabled: true,
  pythonExe: process.platform === "win32" ? "py" : "python3",
  pythonArgs: process.platform === "win32" ? ["-3"] : [],
  scriptPath: fileURLToPath(DEFAULT_SCRIPT_FILE_URL),
  timeoutMs: 3000,
  cooldownMs: 8000,
  staleMs: 180000,
  dryRun: false,
  vid: 0x7807,
  pid: 0xdccb,
  usagePage: 0xff60,
  usage: 0x61,
  profiles: {
    normal: { hue: 64, sat: 255, val: 155, durationMs: 200 },
    question: { hue: 191, sat: 255, val: 155, durationMs: 300 },
    messageError: { hue: 0, sat: 255, val: 155, durationMs: 500 },
    sessionError: { hue: 0, sat: 255, val: 155, durationMs: 500 },
  },
};

const replyStateBySession = new Map<string, ReplyState>();
const lastSentAtBySession = new Map<string, number>();
let settingsReadErrorSignature = "";
let notifyErrorSignature = "";

function parseProfile(value: unknown, fallback: NotifyProfile): NotifyProfile {
  const data = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    hue: parseIntBounded(data.hue, fallback.hue, 0, 255),
    sat: parseIntBounded(data.sat, fallback.sat, 0, 255),
    val: parseIntBounded(data.val, fallback.val, 0, 255),
    durationMs: parseIntBounded(data.durationMs, fallback.durationMs, 100, 5000),
  };
}

function normalizeSettings(value: unknown): RuntimeSettings {
  const data = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const profiles = data.profiles && typeof data.profiles === "object" ? (data.profiles as Record<string, unknown>) : {};
  const device = data.device && typeof data.device === "object" ? (data.device as Record<string, unknown>) : {};

  return {
    enabled: parseBoolean(data.enabled, DEFAULT_SETTINGS.enabled),
    pythonExe: text(data.pythonExe || DEFAULT_SETTINGS.pythonExe) || DEFAULT_SETTINGS.pythonExe,
    pythonArgs: parseStringArray(data.pythonArgs, DEFAULT_SETTINGS.pythonArgs),
    scriptPath: text(data.scriptPath || DEFAULT_SETTINGS.scriptPath) || DEFAULT_SETTINGS.scriptPath,
    timeoutMs: parseIntBounded(data.timeoutMs, DEFAULT_SETTINGS.timeoutMs, 300, 30000),
    cooldownMs: parseIntBounded(data.cooldownMs, DEFAULT_SETTINGS.cooldownMs, 500, 120000),
    staleMs: parseIntBounded(data.staleMs, DEFAULT_SETTINGS.staleMs, 5000, 600000),
    dryRun: parseBoolean(data.dryRun, DEFAULT_SETTINGS.dryRun),
    vid: parseNumberAutoBounded(data.vid ?? device.vid, DEFAULT_SETTINGS.vid, 0, 0xffff),
    pid: parseNumberAutoBounded(data.pid ?? device.pid, DEFAULT_SETTINGS.pid, 0, 0xffff),
    usagePage: parseNumberAutoBounded(data.usagePage ?? device.usagePage, DEFAULT_SETTINGS.usagePage, 0, 0xffff),
    usage: parseNumberAutoBounded(data.usage ?? device.usage, DEFAULT_SETTINGS.usage, 0, 0xff),
    profiles: {
      normal: parseProfile(profiles.normal, DEFAULT_SETTINGS.profiles.normal),
      question: parseProfile(profiles.question, DEFAULT_SETTINGS.profiles.question),
      messageError: parseProfile(profiles.messageError, DEFAULT_SETTINGS.profiles.messageError),
      sessionError: parseProfile(profiles.sessionError, DEFAULT_SETTINGS.profiles.sessionError),
    },
  };
}

async function loadRuntimeSettings(): Promise<RuntimeSettings> {
  const path = fileURLToPath(DEFAULT_SETTINGS_FILE_URL);

  try {
    const parsed = JSON.parse(await readFile(path, "utf8"));
    settingsReadErrorSignature = "";
    return applyEnvOverrides(normalizeSettings(parsed));
  } catch (error) {
    const message = text((error as Error)?.message || error);
    const signature = `${path}|${message}`;
    if (signature !== settingsReadErrorSignature) {
      settingsReadErrorSignature = signature;
      console.warn(`[qmk-led-notifier] Failed to read settings; using defaults: ${message}`);
    }
    return applyEnvOverrides(DEFAULT_SETTINGS);
  }
}

function applyEnvOverrides(settings: RuntimeSettings): RuntimeSettings {
  return {
    ...settings,
    enabled: parseBoolean(getEnvValue("PI_QMK_NOTIFY_ENABLED", "OC_QMK_NOTIFY_ENABLED"), settings.enabled),
    dryRun: parseBoolean(getEnvValue("PI_QMK_NOTIFY_DRY_RUN", "OC_QMK_NOTIFY_DRY_RUN"), settings.dryRun),
    timeoutMs: parseIntBounded(
      getEnvValue("PI_QMK_NOTIFY_TIMEOUT_MS", "OC_QMK_NOTIFY_TIMEOUT_MS"),
      settings.timeoutMs,
      300,
      30000,
    ),
  };
}

function hexWord(value: number): string {
  return `0x${value.toString(16).toUpperCase().padStart(4, "0")}`;
}

function hexByte(value: number): string {
  return `0x${value.toString(16).toUpperCase().padStart(2, "0")}`;
}

function hasRecentlyNotified(sessionKey: string, settings: RuntimeSettings): boolean {
  const last = lastSentAtBySession.get(sessionKey);
  return Boolean(last && Date.now() - last < settings.cooldownMs);
}

function profileForKind(settings: RuntimeSettings, kind: ReturnType<typeof classifyReplyState>): NotifyProfile {
  switch (kind) {
    case "question":
      return settings.profiles.question;
    case "messageError":
      return settings.profiles.messageError;
    case "sessionError":
      return settings.profiles.sessionError;
    default:
      return settings.profiles.normal;
  }
}

async function sendQmkNotification(
  sessionKey: string,
  reason: string,
  settings: RuntimeSettings,
  profile: NotifyProfile,
): Promise<void> {
  const args = [
    ...settings.pythonArgs,
    settings.scriptPath,
    "--flash",
    "--hue",
    String(profile.hue),
    "--sat",
    String(profile.sat),
    "--val",
    String(profile.val),
    "--duration-ms",
    String(profile.durationMs),
    "--timeout-ms",
    String(settings.timeoutMs),
    "--vid",
    hexWord(settings.vid),
    "--pid",
    hexWord(settings.pid),
    "--usage-page",
    hexWord(settings.usagePage),
    "--usage",
    hexByte(settings.usage),
    "--reason",
    reason,
  ];

  if (settings.dryRun) args.push("--dry-run");

  const result = await runProcess(settings.pythonExe, args, settings.timeoutMs);
  if (result.timedOut || result.exitCode !== 0) {
    const signature = `${reason}|${result.exitCode}|${result.stderr.slice(0, 120)}`;
    if (signature !== notifyErrorSignature) {
      notifyErrorSignature = signature;
      console.warn(
        `[qmk-led-notifier] Notification failed for ${sessionKey}: ${result.timedOut ? "timed out" : text(result.stderr) || `exit ${result.exitCode}`}`,
      );
    }
  }
}

export default function qmkLedNotifier(pi: ExtensionAPI) {
  pi.on("agent_start", async (_event, ctx) => {
    replyStateBySession.set(getSessionKey(ctx), createReplyState());
  });

  pi.on("tool_execution_end", async (event, ctx) => {
    const key = getSessionKey(ctx);
    const state = replyStateBySession.get(key) ?? createReplyState();
    if (event.isError) state.hadToolError = true;
    replyStateBySession.set(key, state);
  });

  pi.on("message_end", async (event, ctx) => {
    const key = getSessionKey(ctx);
    const state = replyStateBySession.get(key) ?? createReplyState();
    replyStateBySession.set(key, updateReplyStateFromMessage(state, event.message));
  });

  pi.on("agent_end", async (event, ctx) => {
    const settings = await loadRuntimeSettings();
    if (!settings.enabled) return;

    const key = getSessionKey(ctx);
    let state = replyStateBySession.get(key) ?? createReplyState();
    state = updateReplyStateFromMessages(state, (event as any).messages);
    replyStateBySession.set(key, state);

    if (hasRecentlyNotified(key, settings)) return;
    lastSentAtBySession.set(key, Date.now());

    const kind = classifyReplyState(state);
    await sendQmkNotification(key, `agent_end.${kind}`, settings, profileForKind(settings, kind));
  });
}
