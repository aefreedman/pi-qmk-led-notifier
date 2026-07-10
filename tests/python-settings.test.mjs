import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { resolvePythonSettings } from "../extensions/shared/python-settings.mjs";
import { createProcessRunner } from "../extensions/shared/process-utils.mjs";

const EMPTY_ENV = {};

test("uses platform-specific Python defaults", () => {
  assert.deepEqual(resolvePythonSettings({}, EMPTY_ENV, "win32"), {
    pythonExe: "py",
    pythonArgs: ["-3"],
  });
  assert.deepEqual(resolvePythonSettings({}, EMPTY_ENV, "darwin"), {
    pythonExe: "python3",
    pythonArgs: [],
  });
  assert.deepEqual(resolvePythonSettings({}, EMPTY_ENV, "linux"), {
    pythonExe: "python3",
    pythonArgs: [],
  });
});

test("settings executable and argument overrides take precedence over defaults", () => {
  assert.deepEqual(resolvePythonSettings({ pythonExe: "/opt/custom/python" }, EMPTY_ENV, "win32"), {
    pythonExe: "/opt/custom/python",
    pythonArgs: [],
  });
  assert.deepEqual(resolvePythonSettings({ pythonArgs: ["-I"] }, EMPTY_ENV, "win32"), {
    pythonExe: "py",
    pythonArgs: ["-I"],
  });
  assert.deepEqual(resolvePythonSettings({ pythonExe: "python", pythonArgs: ["-X", "utf8"] }, EMPTY_ENV, "linux"), {
    pythonExe: "python",
    pythonArgs: ["-X", "utf8"],
  });
});

test("settings can explicitly clear platform launcher arguments", () => {
  assert.deepEqual(resolvePythonSettings({ pythonArgs: [] }, EMPTY_ENV, "win32"), {
    pythonExe: "py",
    pythonArgs: [],
  });
});

test("environment overrides settings and clears lower-precedence arguments for a custom executable", () => {
  const settings = { pythonExe: "py", pythonArgs: ["-3"] };

  assert.deepEqual(
    resolvePythonSettings(settings, { PI_QMK_NOTIFY_PYTHON_EXE: "/env/python" }, "win32"),
    { pythonExe: "/env/python", pythonArgs: [] },
  );
  assert.deepEqual(
    resolvePythonSettings(
      settings,
      {
        PI_QMK_NOTIFY_PYTHON_EXE: "/env/python",
        PI_QMK_NOTIFY_PYTHON_ARGS: '["-I", "-X", "utf8"]',
      },
      "win32",
    ),
    { pythonExe: "/env/python", pythonArgs: ["-I", "-X", "utf8"] },
  );
});

test("environment argument override supports an explicit empty JSON array", () => {
  assert.deepEqual(
    resolvePythonSettings(
      { pythonExe: "settings-python", pythonArgs: ["settings-arg"] },
      { PI_QMK_NOTIFY_PYTHON_ARGS: "[]" },
      "win32",
    ),
    { pythonExe: "settings-python", pythonArgs: [] },
  );
});

test("shipped settings leave Python selection to platform defaults", async () => {
  const settingsUrl = new URL("../qmk-notifier.settings.json", import.meta.url);
  const settings = JSON.parse(await readFile(settingsUrl, "utf8"));

  assert.equal(Object.hasOwn(settings, "pythonExe"), false);
  assert.equal(Object.hasOwn(settings, "pythonArgs"), false);
  assert.deepEqual(resolvePythonSettings(settings, EMPTY_ENV, "win32"), {
    pythonExe: "py",
    pythonArgs: ["-3"],
  });
  assert.deepEqual(resolvePythonSettings(settings, EMPTY_ENV, "darwin"), {
    pythonExe: "python3",
    pythonArgs: [],
  });
  assert.deepEqual(resolvePythonSettings(settings, EMPTY_ENV, "linux"), {
    pythonExe: "python3",
    pythonArgs: [],
  });
});

class FakeEmitter {
  listeners = new Map();

  on(event, listener) {
    const listeners = this.listeners.get(event) ?? [];
    listeners.push(listener);
    this.listeners.set(event, listeners);
  }

  removeListener(event, listener) {
    this.listeners.set(event, (this.listeners.get(event) ?? []).filter((candidate) => candidate !== listener));
  }

  emit(event, ...args) {
    for (const listener of [...(this.listeners.get(event) ?? [])]) listener(...args);
  }

  listenerCount(event) {
    return (this.listeners.get(event) ?? []).length;
  }
}

function createFakeChild() {
  const child = new FakeEmitter();
  child.stdout = new FakeEmitter();
  child.stderr = new FakeEmitter();
  child.killed = false;
  child.signals = [];
  child.kill = (signal) => {
    child.killed = true; // Mirrors ChildProcess.killed after the first signal.
    child.signals.push(signal);
    return true;
  };
  return child;
}

function createFakeTimers() {
  const timers = [];
  return {
    setTimeout(callback, delay) {
      const timer = { callback, delay, cleared: false };
      timers.push(timer);
      return timer;
    },
    clearTimeout(timer) {
      timer.cleared = true;
    },
    fire(delay) {
      const timer = timers.find((candidate) => candidate.delay === delay && !candidate.cleared);
      assert(timer, `Expected an active ${delay}ms timer.`);
      timer.callback();
    },
    timer(delay) {
      return timers.find((candidate) => candidate.delay === delay);
    },
  };
}

test("process timeout escalates after grace even when ChildProcess.killed is true", async () => {
  const child = createFakeChild();
  const timers = createFakeTimers();
  const run = createProcessRunner({
    spawnImpl: () => child,
    setTimeoutImpl: timers.setTimeout,
    clearTimeoutImpl: timers.clearTimeout,
    killGraceMs: 2,
  });

  const result = run("fake", [], 5);
  timers.fire(5);
  assert.deepEqual(child.signals, ["SIGTERM"]);
  timers.fire(2);

  assert.deepEqual(child.signals, ["SIGTERM", "SIGKILL"]);
  assert.deepEqual(await result, { exitCode: null, stdout: "", stderr: "", timedOut: true });
  assert.equal(child.listenerCount("error"), 1, "terminal error handling must remain until the child actually settles");
  child.emit("error", new Error("late child error after forced timeout"));
  assert.equal(child.listenerCount("error"), 0);
  assert.equal(child.listenerCount("close"), 0);
});

test("process close clears escalation timers and listeners", async () => {
  const child = createFakeChild();
  const timers = createFakeTimers();
  const run = createProcessRunner({
    spawnImpl: () => child,
    setTimeoutImpl: timers.setTimeout,
    clearTimeoutImpl: timers.clearTimeout,
    killGraceMs: 3,
  });

  const result = run("fake", [], 7);
  timers.fire(7);
  child.emit("close", 143);

  assert.deepEqual(await result, { exitCode: 143, stdout: "", stderr: "", timedOut: true });
  assert.equal(timers.timer(3)?.cleared, true);
  assert.equal(child.listenerCount("close"), 0);
  assert.equal(child.stdout.listenerCount("data"), 0);
});

test("process spawn errors preserve ENOENT for executable diagnostics", async () => {
  const child = createFakeChild();
  const run = createProcessRunner({ spawnImpl: () => child });
  const result = run("missing-python", [], 10);
  child.emit("error", Object.assign(new Error("spawn missing-python ENOENT"), { code: "ENOENT" }));
  assert.equal((await result).spawnErrorCode, "ENOENT");
});

test("the package test runner propagates assertion failures", async () => {
  const fixtureDirectory = await mkdtemp(path.join(tmpdir(), "pi-qmk-runner-"));
  const fixturePath = path.join(fixtureDirectory, "intentional-failure.test.mjs");

  try {
    await writeFile(
      fixturePath,
      'import assert from "node:assert/strict"; import test from "node:test"; test("intentional", () => assert.equal(1, 2));\n',
    );
    const childEnvironment = { ...process.env };
    delete childEnvironment.NODE_TEST_CONTEXT;
    const result = spawnSync(process.execPath, ["--test", fixturePath], {
      encoding: "utf8",
      env: childEnvironment,
    });
    assert.notEqual(result.status, 0, `expected non-zero status; stdout: ${result.stdout}\nstderr: ${result.stderr}`);
  } finally {
    await rm(fixtureDirectory, { recursive: true, force: true });
  }
});
