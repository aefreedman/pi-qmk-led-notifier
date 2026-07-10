function normalizeExecutable(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeArguments(value) {
  if (!Array.isArray(value)) return undefined;
  return value.map((entry) => String(entry ?? "").trim()).filter(Boolean);
}

function parseEnvironmentArguments(value) {
  if (typeof value !== "string") return undefined;

  try {
    return normalizeArguments(JSON.parse(value));
  } catch {
    return undefined;
  }
}

export function getDefaultPythonSettings(platform = process.platform) {
  return platform === "win32"
    ? { pythonExe: "py", pythonArgs: ["-3"] }
    : { pythonExe: "python3", pythonArgs: [] };
}

export function resolvePythonSettings(settings = {}, environment = process.env, platform = process.platform) {
  const data = settings && typeof settings === "object" ? settings : {};
  const env = environment && typeof environment === "object" ? environment : {};
  const defaults = getDefaultPythonSettings(platform);

  const settingsExe = normalizeExecutable(data.pythonExe);
  const settingsArgs = normalizeArguments(data.pythonArgs);
  const environmentExe = normalizeExecutable(env.PI_QMK_NOTIFY_PYTHON_EXE);
  const environmentArgs = parseEnvironmentArguments(env.PI_QMK_NOTIFY_PYTHON_ARGS);

  const pythonExe = environmentExe || settingsExe || defaults.pythonExe;

  let pythonArgs;
  if (environmentArgs !== undefined) {
    pythonArgs = environmentArgs;
  } else if (environmentExe) {
    pythonArgs = [];
  } else if (settingsArgs !== undefined) {
    pythonArgs = settingsArgs;
  } else if (settingsExe) {
    pythonArgs = [];
  } else {
    pythonArgs = defaults.pythonArgs;
  }

  return { pythonExe, pythonArgs: [...pythonArgs] };
}
