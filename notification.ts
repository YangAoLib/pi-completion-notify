import { spawn, execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

export const TTL_MS = 10 * 60 * 1000;
export function safeLabel(text: string): string {
  return Array.from(text.replace(/[\x00-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069;]/g, " ")
    .replace(/\b\d{17}[\dXx]\b/g, "[已脱敏]").replace(/\b1[3-9]\d{9}\b/g, "[已脱敏]")).slice(0, 70).join("");
}
export function variable(name: "PI_COMPLETION_STATE" | "PI_COMPLETION_FOCUS", value: object): string {
  return `\x1b]1337;SetUserVar=${name}=${Buffer.from(JSON.stringify(value)).toString("base64")}\x07`;
}
export function supportsNotification(mode: string, env = process.env, tty = process.stdout.isTTY): boolean {
  return process.platform === "win32" && mode === "tui" && !!tty && env.TERM_PROGRAM === "WezTerm" && /^\d+$/.test(env.WEZTERM_PANE ?? "");
}
export function validClick(value: unknown, id: string, deadline: number, now = Date.now()): boolean {
  if (!value || typeof value !== "object" || now >= deadline) return false;
  const v = value as Record<string, unknown>;
  return v.kind === "open" && v.id === id;
}

/** 不传递对话或命令内容；子进程只有显示通知和回传按钮事件的职责。 */
export function showCompletion(cwd: string, warn: (message: string) => void): () => void {
  const id = randomUUID();
  const deadline = Date.now() + TTL_MS;
  const pane = process.env.WEZTERM_PANE!;
  const gui = process.env.WEZTERM_EXECUTABLE;
  const cli = gui ? join(dirname(gui), "wezterm.exe") : undefined;
  const binary = fileURLToPath(new URL("./windows/bin/CompletionToast.exe", import.meta.url));
  if (!existsSync(binary)) { warn("完成通知辅助程序未安装，请先运行 windows/install.ps1"); return () => {}; }
  const env: NodeJS.ProcessEnv = {};
  for (const name of ["SystemRoot", "WINDIR", "TEMP", "TMP", "USERPROFILE", "LOCALAPPDATA", "APPDATA"]) {
    if (process.env[name]) env[name] = process.env[name];
  }
  const child = spawn(binary, [], { windowsHide: true, stdio: ["pipe", "pipe", "ignore"], env });
  let closed = false, ready = false, warned = false, opening = false;
  let buffer = "", size = 0;
  let killTimer: ReturnType<typeof setTimeout> | undefined;
  let focusProcess: ReturnType<typeof execFile> | undefined;
  const write = (s: string) => { try { process.stdout.write(s); } catch {} };
  const startup = setTimeout(() => { if (!ready) fail(); }, 5000);
  const expiry = setTimeout(stop, TTL_MS);
  function stop() {
    if (closed) return;
    closed = true;
    clearTimeout(startup); clearTimeout(expiry);
    focusProcess?.kill();
    write(variable("PI_COMPLETION_STATE", { id, deadline: 0 }));
    child.stdin.end();
    if (child.exitCode === null && child.signalCode === null) {
      killTimer = setTimeout(() => child.kill(), 1000); killTimer.unref();
    }
  }
  function fail() {
    stop();
    if (!warned) { warned = true; warn("桌面完成通知不可用；请检查 Windows 通知权限及通知程序安装状态"); }
  }
  child.on("error", fail);
  child.stdin.on("error", () => { if (!closed) fail(); });
  child.on("exit", () => {
    clearTimeout(killTimer);
    if (!closed) { if (!ready) fail(); else stop(); }
    clearTimeout(killTimer);
  });
  child.stdout.on("data", (chunk: Buffer) => {
    size += chunk.length;
    if (size > 4096) { fail(); return; }
    buffer += chunk.toString("utf8");
    let n: number;
    while ((n = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, n).replace(/^\uFEFF/, ""); buffer = buffer.slice(n + 1);
      try {
        const value = JSON.parse(line);
        if (closed) continue;
        if (value.kind === "ready") { ready = true; clearTimeout(startup); }
        else if (value.kind === "error") fail();
        else if (!opening && validClick(value, id, deadline)) {
          opening = true;
          if (!cli || !existsSync(cli)) { warn("无法找到 wezterm.exe，请手动打开对应 pane"); stop(); continue; }
          focusProcess = execFile(cli, ["cli", "--no-auto-start", "activate-pane", "--pane-id", pane],
            { windowsHide: true, timeout: 3000 }, error => {
              focusProcess = undefined;
              if (closed || Date.now() >= deadline) return;
              if (error) { warn("无法切换到原 WezTerm pane，它可能已关闭"); stop(); return; }
              write(variable("PI_COMPLETION_FOCUS", { id, deadline, requestedAt: Date.now() }));
              // Lua 会在处理焦点消息时读取状态；不能立即清空，否则导致事件竞态。
              setTimeout(stop, 1500).unref();
            });
        }
      } catch { fail(); }
    }
  });
  write(variable("PI_COMPLETION_STATE", { id, deadline }));
  child.stdin.write(JSON.stringify({ id, deadline, title: `Pi 本轮执行已结束 · pane ${pane}`,
    body: `${safeLabel(basename(cwd))}：点击打开终端查看结果。此提醒不代表任务成功。` }) + "\n");
  return stop;
}
