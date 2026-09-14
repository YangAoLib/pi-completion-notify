# Pi 完成通知

Windows + WezTerm 的轻量 Pi 全局插件。AI 本轮执行完全结束后显示桌面通知，点击“打开对应终端”切换回原 pane，并最大化、前置其所属窗口。

与命令审核无关：不审核或拦截命令，不使用模型，不依赖 pi-subagents，不会重新安装旧审核扩展。

## 安装

需要支持 `agent_settled` 事件的 Pi、Windows x64、WezTerm 和 PowerShell 7。测试使用 Node.js 24 或更高版本。本项目不修改 Pi 源码或安装其它 Pi 扩展。

将仓库克隆到全局扩展目录（如果已有该目录，请先备份，不要覆盖）：

```powershell
git clone https://github.com/YangAoLib/pi-completion-notify.git "$HOME/.pi/agent/extensions/pi-completion-notify"
```

在 Windows x64 使用系统自带 .NET Framework 编译器构建通知辅助程序并注册开始菜单身份：

```powershell
pwsh -NoProfile -File "$HOME/.pi/agent/extensions/pi-completion-notify/windows/install.ps1"
```

在现有 WezTerm Lua 配置中加入，不覆盖其它配置：

```lua
local ok, completion = pcall(dofile, wezterm.home_dir .. '/.pi/agent/extensions/pi-completion-notify/wezterm.lua')
if ok then completion.setup() end
```

Pi 执行 `/reload` 后生效。

## 使用

```text
/completion-notify
/completion-notify status
/completion-notify test
```

输入 `/completion-notify `（末尾空格）可补全 `status`、`test`，并显示中文说明；无参数等同于 `status`。

`test` 立即发出带按钮的桌面通知，不执行 AI 或业务命令。切换到其它程序后点击按钮，验证是否切回原 pane 和最大化窗口。

## 工作方式与边界

- 监听 `agent_start` 和 `agent_settled`，不在每一轮工具执行或 `agent_end` 时通知，避免重试/压缩过程中误报。
- 通知表达“本轮执行已结束”，不是任务成功保证；错误、用户中止最终进入 settled 时同样可能提示，应打开终端看结果。
- 只在 Windows、WezTerm、交互 TUI 和真实 TTY 下发送；RPC/JSON/后台会话不污染输出。
- 每个 Pi 会话只保留最新一条通知，最长 10 分钟。新任务开始、退出或重载会话时清理旧通知和辅助程序。有效期之外的按钮不再处理。
- 通知只包含项目目录名和 pane 编号，不发送命令正文、对话或模型答案；不创建日志。目录名仍可能包含业务信息，请注意系统通知可能在锁屏上展示。
- 辅助进程通过 stdin/stdout 与当前 Pi 通信，只返回固定 `open` 事件和随机通知 ID；不监听 HTTP，不注册退出后执行命令的 URL 协议。
- 点击后使用固定 `wezterm cli --no-auto-start activate-pane --pane-id ...`，不将内容粘贴进终端，不创建新 pane，不按进程名猜测窗口。随后 OSC 用户变量使原 pane 对应的 Lua window 执行 maximize/focus。
- 窗口只在点击后最大化和聚焦；当前窗口无论原先是普通大小还是最小化，都按最大化处理。Windows 仍可能限制前台激活。
- 系统通知权限、勿扰模式会影响显示；API ready 不等于用户看到了横幅。后台辅助程序退出后的旧通知不支持重新激活，这是为了避免过期 pane 和脱离原会话的操作。

## 开源与隐私

采用 [MIT License](LICENSE)。仓库仅包含源码、测试及通用安装说明，不包含本机 WezTerm 配置、开始菜单快捷方式、对话历史或已编译二进制。

`data/`、备份、日志、认证配置及 `windows/bin/` 均被 `.gitignore` 排除。辅助程序需要在本机构建，个人配置备份保留在本地，不应强制加入版本控制。仓库发布前的静态扫描不能替代后续提交的人工检查。

## 本地文件

- `windows/bin/CompletionToast.exe`：本机构建产物，Git 忽略。
- `data/backups/`：已有通知快捷方式、WezTerm 配置等备份，Git 忽略。
- 开始菜单 `Pi Completion Notify.lnk`：独立 AppUserModelID `Pi.CompletionNotify`，不使用 WezTerm 或旧审批器身份。

无需 .NET SDK、NuGet、Electron 或第三方依赖；需要 Windows x64 的 .NET Framework 编译器及 WinRT 元数据。

## 测试

```bash
node --test tests/*.test.ts
wezterm --config-file <扩展绝对目录>/tests/wezterm.lua show-keys --lua
```

测试不点击真实按钮。实机验收用 `/completion-notify test`，桌面按钮行为须人工验证。

## 卸载

先退出 Pi，再执行（支持 `-WhatIf`）：

```powershell
pwsh -NoProfile -File "$HOME/.pi/agent/extensions/pi-completion-notify/windows/uninstall.ps1"
```

移除 WezTerm Lua 中的加载段；归档 `data/` 后移走本扩展目录。卸载脚本只删除本扩展快捷方式和二进制，不修改 WezTerm 本体、系统通知权限或历史备份。
