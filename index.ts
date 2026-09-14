import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { showCompletion, supportsNotification } from "./notification.ts";

export default function completionNotify(pi: ExtensionAPI) {
  let armed = false;
  let stop: (() => void) | undefined;
  const clear = () => { stop?.(); stop = undefined; };
  pi.on("session_start", () => { armed = false; clear(); });
  pi.on("agent_start", () => { armed = true; clear(); });
  // 不使用 agent_end：重试、压缩、后续消息都完成后再通知。
  pi.on("agent_settled", (_event, ctx) => {
    if (!armed) return;
    armed = false;
    clear();
    if (!supportsNotification(ctx.mode)) return;
    stop = showCompletion(ctx.cwd, message => ctx.ui.notify(message, "warning"));
  });
  pi.on("session_shutdown", () => { armed = false; clear(); });
  pi.registerCommand("completion-notify", {
    description: "完成通知：status 查看状态；test 发送测试通知",
    getArgumentCompletions: prefix => {
      const items = [
        { value: "status", label: "status", description: "查看完成通知状态与使用说明" },
        { value: "test", label: "test", description: "发送带打开 WezTerm pane 按钮的测试通知" },
      ].filter(item => item.value.startsWith(prefix));
      return items.length ? items : null;
    },
    handler: async (args, ctx) => {
      const action = args.trim();
      if (action && action !== "status" && action !== "test") {
        ctx.ui.notify("未知子命令。可使用 /completion-notify status 或 /completion-notify test", "warning");
        return;
      }
      if (action === "test") {
        if (!supportsNotification(ctx.mode)) { ctx.ui.notify("测试需要 Windows WezTerm 的交互式 Pi 终端", "warning"); return; }
        clear();
        stop = showCompletion(ctx.cwd, message => ctx.ui.notify(message, "warning"));
        ctx.ui.notify("已发起测试通知；按钮仅切换终端，不执行 AI 命令。", "info");
        return;
      }
      ctx.ui.notify("完成通知：本轮 AI 完全结束后发送；点击打开对应 WezTerm pane 并最大化窗口。通知有效期 10 分钟，新任务开始或退出会话后失效。", "info");
    },
  });
}
