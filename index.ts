import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { showCompletion } from "./notification.ts";
import {
  captureWindowsTerminalTarget, createWezTermTarget, createWindowsTerminalTarget,
  detectTerminal, fallbackTabName, readInstalledTerminals,
  type TerminalKind, type WindowsTerminalTarget,
} from "./terminal.ts";

function installedLabel(kind: TerminalKind): string {
  return kind === "wezterm" ? "WezTerm" : "Windows Terminal";
}

function statusText(kind: TerminalKind | null, installed: Set<TerminalKind>): string {
  const available = [...installed].map(installedLabel).join("、") || "无";
  if (!kind) {
    return `完成通知未启用：当前终端不是安装时启用的 Windows 交互 TUI。已安装：${available}。`;
  }
  const mode = kind === "windows-terminal"
    ? "点击后最大化并前置窗口，切回对应标签页；分屏时尽力定位原 pane，失败则停在标签页。"
    : "点击后切换回对应 pane 并最大化源窗口。";
  return `完成通知：本轮 AI 完全结束后发送；${mode}通知有效期 10 分钟，新任务开始或退出会话后失效。已安装：${available}。`;
}

export default function completionNotify(pi: ExtensionAPI) {
  let armed = false;
  let stop: (() => void) | undefined;
  let run = 0;
  let captureSeq = 0;
  let capturePromise: Promise<WindowsTerminalTarget | null> | undefined;
  let lastCapture: WindowsTerminalTarget | undefined;
  let captureTimer: ReturnType<typeof setTimeout> | undefined;

  const clear = () => { stop?.(); stop = undefined; };
  const kindOf = (ctx?: ExtensionContext): TerminalKind | null =>
    detectTerminal(ctx?.mode ?? "", process.env, process.stdout.isTTY);

  function cancelCaptureTimer() {
    if (captureTimer) clearTimeout(captureTimer);
    captureTimer = undefined;
  }

  function startCapture(ctx: ExtensionContext): Promise<WindowsTerminalTarget | null> {
    const seq = ++captureSeq;
    const promise = captureWindowsTerminalTarget().then(capture => {
      if (seq === captureSeq && capture) lastCapture = capture;
      return capture;
    }).catch(() => null);
    capturePromise = promise;
    return promise;
  }

  async function latestCapture(currentRun: number): Promise<WindowsTerminalTarget | undefined> {
    const pending = capturePromise;
    if (pending) {
      const fresh = await Promise.race([pending, sleep(1500).then(() => null)]);
      if (currentRun !== run) return lastCapture;
      if (fresh) return fresh;
    }
    return lastCapture;
  }

  function scheduleCapture(ctx: ExtensionContext) {
    cancelCaptureTimer();
    if (kindOf(ctx) !== "windows-terminal") return;
    captureTimer = setTimeout(() => { if (kindOf(ctx) === "windows-terminal") startCapture(ctx); }, 300);
    captureTimer.unref();
  }

  pi.on("session_start", (_event, ctx) => {
    armed = false;
    clear();
    run++;
    captureSeq++;
    cancelCaptureTimer();
    lastCapture = undefined;
    capturePromise = undefined;
    scheduleCapture(ctx);
  });

  pi.on("agent_start", (_event, ctx) => {
    armed = true;
    clear();
    run++;
    cancelCaptureTimer();
    if (kindOf(ctx) === "windows-terminal") startCapture(ctx);
  });

  // 不使用 agent_end：重试、压缩、后续消息都完成后再通知。
  pi.on("agent_settled", async (_event, ctx) => {
    if (!armed) return;
    armed = false;
    clear();
    const kind = kindOf(ctx);
    if (!kind) return;
    const currentRun = run;
    try {
      const target = kind === "wezterm"
        ? createWezTermTarget()
        : createWindowsTerminalTarget(ctx.cwd, await latestCapture(currentRun));
      if (currentRun !== run) return;
      stop = showCompletion(ctx.cwd, target, message => ctx.ui.notify(message, "warning"));
    } catch (error) {
      ctx.ui.notify(error instanceof Error ? error.message : String(error), "warning");
    }
  });

  pi.on("session_shutdown", () => {
    armed = false;
    run++;
    captureSeq++;
    cancelCaptureTimer();
    clear();
    lastCapture = undefined;
    capturePromise = undefined;
  });

  async function testCompletion(ctx: ExtensionContext, kind: TerminalKind) {
    clear();
    if (kind === "wezterm") {
      stop = showCompletion(ctx.cwd, createWezTermTarget(), message => ctx.ui.notify(message, "warning"));
      ctx.ui.notify("已发起测试通知；按钮仅切换终端，不执行 AI 命令。", "info");
      return;
    }
    const capture = await captureWindowsTerminalTarget();
    if (!capture) {
      ctx.ui.notify(`未捕获到 Windows Terminal 标签页；点击可能无法定位。回退标题：${fallbackTabName(ctx.cwd)}`, "warning");
    }
    stop = showCompletion(ctx.cwd, createWindowsTerminalTarget(ctx.cwd, capture), message => ctx.ui.notify(message, "warning"));
    ctx.ui.notify("已发起测试通知；分屏时优先定位原 pane，失败则打开标签页。", "info");
  }

  pi.registerCommand("completion-notify", {
    description: "完成通知：status 查看状态；test 发送测试通知",
    getArgumentCompletions: prefix => {
      const items = [
        { value: "status", label: "status", description: "查看完成通知状态与使用说明" },
        { value: "test", label: "test", description: "发送带打开终端按钮的测试通知" },
      ].filter(item => item.value.startsWith(prefix));
      return items.length ? items : null;
    },
    handler: async (args, ctx) => {
      const action = args.trim();
      if (action && action !== "status" && action !== "test") {
        ctx.ui.notify("未知子命令。可使用 /completion-notify status 或 /completion-notify test", "warning");
        return;
      }
      const kind = detectTerminal(ctx.mode, process.env, process.stdout.isTTY);
      if (action === "test") {
        if (!kind) {
          ctx.ui.notify("测试需要安装时启用的 Windows WezTerm 或 Windows Terminal 交互式 Pi 终端", "warning");
          return;
        }
        await testCompletion(ctx, kind);
        return;
      }
      ctx.ui.notify(statusText(kind, readInstalledTerminals()), "info");
    },
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => { const timer = setTimeout(resolve, ms); timer.unref(); });
}
