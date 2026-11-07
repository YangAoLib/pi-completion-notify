import { execFile, spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { variable } from "./notification.ts";
import type { CompletionTarget } from "./notification.ts";

const execFileAsync = promisify(execFile);
const FOCUS_SCRIPT = fileURLToPath(new URL("./windows/windows-terminal.ps1", import.meta.url));
const INSTALLATION_RECORD = fileURLToPath(new URL("./data/installation.json", import.meta.url));
const POWERSHELL = join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");

export type TerminalKind = "wezterm" | "windows-terminal";
export const ALL_TERMINALS: TerminalKind[] = ["wezterm", "windows-terminal"];

export interface WindowsTerminalTarget {
  version: 1;
  hwnd: number;
  tabIndex: number;
  tabName: string;
  termRuntimeId?: number[];
  termRect?: [number, number, number, number];
  capturedAt: number;
}

interface InstallationRecord {
  version?: number;
  terminals?: unknown;
  configPath?: unknown;
}

export function readInstalledTerminals(recordPath = INSTALLATION_RECORD): Set<TerminalKind> {
  try {
    const record = JSON.parse(readFileSync(recordPath, "utf8")) as InstallationRecord;
    if (record.version === 2 && Array.isArray(record.terminals)) {
      return new Set(record.terminals.filter((value): value is TerminalKind =>
        value === "wezterm" || value === "windows-terminal"));
    }
  } catch {}
  return new Set(ALL_TERMINALS);
}

export function detectTerminal(
  mode: string,
  env: NodeJS.ProcessEnv = process.env,
  tty: boolean | undefined = process.stdout.isTTY,
  installed: Set<TerminalKind> = readInstalledTerminals(),
  platform: NodeJS.Platform = process.platform,
): TerminalKind | null {
  if (platform !== "win32" || mode !== "tui" || !tty) return null;
  const wezterm = env.TERM_PROGRAM === "WezTerm" && /^\d+$/.test(env.WEZTERM_PANE ?? "");
  if (wezterm && installed.has("wezterm")) return "wezterm";
  const windowsTerminal = !!env.WT_SESSION?.trim() || !!env.WT_PROFILE_ID?.trim() || env.TERM_PROGRAM === "Windows_Terminal";
  if (windowsTerminal && installed.has("windows-terminal")) return "windows-terminal";
  return null;
}

export function createWezTermTarget(env: NodeJS.ProcessEnv = process.env): CompletionTarget {
  const pane = env.WEZTERM_PANE!;
  const gui = env.WEZTERM_EXECUTABLE;
  const cli = gui ? join(dirname(gui), "wezterm.exe") : undefined;
  return {
    kind: "wezterm",
    label: `pane ${pane}`,
    prepare: ({ id, deadline }) => {
      try { process.stdout.write(variable("PI_COMPLETION_STATE", { id, deadline })); } catch {}
    },
    focus: async ({ id, deadline }) => {
      if (!cli || !existsSync(cli)) throw new Error("无法找到 wezterm.exe，请手动打开对应 pane");
      try {
        await execFileAsync(cli, ["cli", "--no-auto-start", "activate-pane", "--pane-id", pane],
          { windowsHide: true, timeout: 3000 });
      } catch {
        throw new Error("无法切换到原 WezTerm pane，它可能已关闭");
      }
      try { process.stdout.write(variable("PI_COMPLETION_FOCUS", { id, deadline, requestedAt: Date.now() })); } catch {}
      // Lua 会在处理焦点消息时读取状态；不能立即清空，否则导致事件竞态。
      await delay(1500);
    },
    reset: ({ id }) => {
      try { process.stdout.write(variable("PI_COMPLETION_STATE", { id, deadline: 0 })); } catch {}
    },
  };
}

export function fallbackTabName(cwd: string): string {
  return `π - ${basename(cwd) || "pi"}`;
}

export function createWindowsTerminalTarget(cwd: string, capture?: WindowsTerminalTarget | null): CompletionTarget {
  const payload: WindowsTerminalTarget = capture ?? {
    version: 1,
    hwnd: 0,
    tabIndex: -1,
    tabName: fallbackTabName(cwd),
    capturedAt: Date.now(),
  };
  return {
    kind: "windows-terminal",
    label: "Windows Terminal",
    focusHwnd: payload.hwnd > 0 ? payload.hwnd : undefined,
    prepare: () => {},
    focus: async () => {
      const raw = await runFocusScript("focus", payload, 6000);
      const result = parseFocusResult(raw);
      if (!result.ok || !result.tabSelected) throw new Error(focusReason(result.reason));
    },
    reset: () => {},
  };
}

export async function captureWindowsTerminalTarget(timeoutMs = 3000): Promise<WindowsTerminalTarget | null> {
  if (process.platform !== "win32") return null;
  try {
    const raw = await runFocusScript("capture", undefined, timeoutMs);
    const record = asRecord(raw);
    if (!record || record.ok !== true) return null;
    return parseWindowsTerminalTarget(record);
  } catch {
    return null;
  }
}

export function parseWindowsTerminalTarget(value: unknown): WindowsTerminalTarget | null {
  const record = asRecord(value);
  if (!record || record.version !== 1) return null;
  const hwnd = integer(record.hwnd, 0);
  const tabIndex = integer(record.tabIndex, -1);
  const capturedAt = number(record.capturedAt);
  if (hwnd === null || tabIndex === null || capturedAt === null) return null;
  if (typeof record.tabName !== "string" || record.tabName.length > 512) return null;
  const termRuntimeId = runtimeId(record.termRuntimeId);
  if (record.termRuntimeId !== undefined && !termRuntimeId) return null;
  const termRect = rect(record.termRect);
  if (record.termRect !== undefined && !termRect) return null;
  return {
    version: 1, hwnd, tabIndex, tabName: record.tabName,
    ...(termRuntimeId ? { termRuntimeId } : {}),
    ...(termRect ? { termRect } : {}),
    capturedAt,
  };
}

interface FocusResult {
  ok: boolean;
  tabSelected: boolean;
  paneFocused: boolean;
  reason?: string;
}

export function parseFocusResult(value: unknown): FocusResult {
  const record = asRecord(value);
  if (!record || typeof record.ok !== "boolean") throw new Error("终端聚焦脚本返回无效结果");
  return {
    ok: record.ok,
    tabSelected: record.tabSelected === true,
    paneFocused: record.paneFocused === true,
    reason: typeof record.reason === "string" && record.reason.length <= 200 ? record.reason : undefined,
  };
}

function focusReason(reason?: string): string {
  switch (reason) {
    case "window-not-found": return "无法定位原 Windows Terminal 窗口，它可能已关闭";
    case "tab-not-found": return "无法定位原 Windows Terminal 标签页，它可能已关闭或移动";
    case "invalid-input": return "Windows Terminal 聚焦请求无效";
    default: return reason || "无法定位原 Windows Terminal 标签页，请手动切换";
  }
}

async function runFocusScript(mode: "capture" | "focus", input?: unknown, timeoutMs = 6000): Promise<unknown> {
  if (!existsSync(FOCUS_SCRIPT)) throw new Error("Windows Terminal 聚焦脚本未安装，请重新运行 setup");
  if (!existsSync(POWERSHELL)) throw new Error("未找到 Windows PowerShell，无法定位 Windows Terminal");
  return new Promise((resolve, reject) => {
    const child = spawn(POWERSHELL,
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", FOCUS_SCRIPT, mode],
      { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "", stderr = "", size = 0, settled = false;
    const timer = setTimeout(() => finish(() => { child.kill(); reject(new Error("终端聚焦脚本超时")); }), timeoutMs);
    function finish(action: () => void) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      action();
    }
    child.on("error", error => finish(() => reject(error)));
    child.stdout?.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > 65536) { child.kill(); finish(() => reject(new Error("终端聚焦脚本输出过大"))); return; }
      stdout += chunk.toString("utf8");
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      if (stderr.length < 4096) stderr += chunk.toString("utf8");
    });
    child.on("close", code => finish(() => {
      try {
        const value = parseJsonOutput(stdout);
        if (code !== 0) {
          const reason = asRecord(value)?.reason;
          reject(new Error(typeof reason === "string" ? reason : stderr.trim() || `终端聚焦脚本失败（退出码 ${code}）`));
          return;
        }
        resolve(value);
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    }));
    if (input !== undefined && child.stdin) child.stdin.write(JSON.stringify(input) + "\n");
    child.stdin?.end();
  });
}

function parseJsonOutput(output: string): unknown {
  const lines = output.replace(/^\uFEFF/, "").split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index--) {
    try { return JSON.parse(lines[index]); } catch {}
  }
  throw new Error("终端聚焦脚本未返回有效 JSON");
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function integer(value: unknown, minimum: number): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= minimum ? value : null;
}

function number(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function runtimeId(value: unknown): number[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length === 0 || value.length > 64) return undefined;
  const result = value.filter((item): item is number => typeof item === "number" && Number.isInteger(item) && item >= 0);
  return result.length === value.length ? result : undefined;
}

function rect(value: unknown): [number, number, number, number] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length !== 4) return undefined;
  const result = value.filter((item): item is number => typeof item === "number" && Number.isFinite(item));
  return result.length === 4 && result[2] > 0 && result[3] > 0 ? [result[0], result[1], result[2], result[3]] : undefined;
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => { const timer = setTimeout(resolve, ms); timer.unref(); });
}
