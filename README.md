# Pi 完成通知

Windows Terminal / WezTerm 的轻量 Pi 全局插件。AI 本轮执行完全结束后显示桌面通知，点击“打开对应终端”切换回原终端：WezTerm 定位到 pane，Windows Terminal 优先定位分屏 pane，识别失败则打开对应标签页，并最大化、前置其所属窗口。

与命令审核无关：不审核或拦截命令，不使用模型，不依赖 pi-subagents，不会重新安装旧审核扩展。

## 安装

需要支持 `agent_settled` 事件的 Pi、Windows x64，以及 WezTerm 或 Windows Terminal。安装使用 PowerShell 7；Windows Terminal 聚焦使用系统自带 Windows PowerShell 5.1 和 UI Automation。测试使用 Node.js 24 或更高版本。本项目不修改 Pi 源码或安装其它 Pi 扩展。

### 方法一：pi install（推荐）

```powershell
pi install git:github.com/YangAoLib/pi-completion-notify
```

安装过程中 `postinstall` 首次安装时自动检测已安装的终端：检测到 WezTerm 就合并其配置，检测到 Windows Terminal 就只安装通知组件（WT 无需改配置），两个都存在则都启用。已有显式选择且安装记录仍在时会沿用；`pi update` 会清理包目录，更新前可设置 `PI_COMPLETION_TERMINALS` 或更新后重新运行 setup。随后 `/reload` 即可。

如果不希望自动检测，可在安装前用环境变量指定：

```powershell
$env:PI_COMPLETION_TERMINALS = 'windows-terminal'   # 或 wezterm / both
pi install git:github.com/YangAoLib/pi-completion-notify
```

默认全局安装目录为 `~/.pi/agent/git/github.com/YangAoLib/pi-completion-notify`。如果 npm 禁止生命周期脚本、自动检测结果不符合预期或自动初始化失败，使用独立入口：

```powershell
$agentDir = if ($env:PI_CODING_AGENT_DIR) { $env:PI_CODING_AGENT_DIR } else { "$HOME/.pi/agent" }
$pluginDir = "$agentDir/git/github.com/YangAoLib/pi-completion-notify"
npm --prefix "$pluginDir" run setup -- --terminal windows-terminal
# 只启用 WezTerm：
npm --prefix "$pluginDir" run setup -- --terminal wezterm
# 两个都启用：
npm --prefix "$pluginDir" run setup -- --terminal both
# 自定义 WezTerm 配置位置时显式指定：
npm --prefix "$pluginDir" run setup -- --terminal wezterm --config "$HOME/.wezterm.lua"
```

初始化脚本自动写入实际安装路径，不需要手动加 Lua。只有选择 WezTerm 时才需要等价加载段：

```lua
local agent_dir = os.getenv('PI_CODING_AGENT_DIR') or (wezterm.home_dir .. '/.pi/agent')
local ok, completion = pcall(dofile, agent_dir .. '/git/github.com/YangAoLib/pi-completion-notify/wezterm.lua')
if ok then completion.setup() end
```

在 Pi 执行 `/reload`，再执行 `/completion-notify test` 验证。

自动化需要 npm 允许运行 `postinstall`；不会绕过 `ignore-scripts` 或 `allow-scripts`。脚本失败会明确提示修复入口，postinstall 保留包安装结果，显式 setup 失败返回非零。仓库未发布到 npm，请使用 Git 来源，不要运行 `pi install npm:pi-completion-notify`。

更新：

```powershell
pi update git:github.com/YangAoLib/pi-completion-notify
# 若更新阶段禁用了生命周期脚本，再执行：
npm --prefix "$pluginDir" run setup
```

更新前关闭现有 Pi 会话，并归档本地 `data/`：包管理器可能重置/清理 Git 安装目录中的本地产物，更新后需重新编译。若之前手动克隆到 `extensions/pi-completion-notify`，请先归档并移走那份目录，再启用 Git 包，避免重复加载、重复通知。WezTerm 也只保留一个版本的加载段。

如果只需 Windows Terminal，更新时显式指定，避免自动检测重新启用 WezTerm：

```powershell
$env:PI_COMPLETION_TERMINALS = 'windows-terminal'
pi update git:github.com/YangAoLib/pi-completion-notify
```

### 方法二：手动克隆

将仓库克隆到全局扩展目录（如果已有该目录，请先备份，不要覆盖）：

```powershell
git clone https://github.com/YangAoLib/pi-completion-notify.git "$HOME/.pi/agent/extensions/pi-completion-notify"
```

在 Windows x64 使用系统自带 .NET Framework 编译器构建通知辅助程序并注册开始菜单身份；Windows Terminal 不需要额外配置：

```powershell
pwsh -NoProfile -File "$HOME/.pi/agent/extensions/pi-completion-notify/windows/install.ps1"
```

只有使用 WezTerm 时，才在现有 Lua 配置中加入，不覆盖其它配置：

```lua
local ok, completion = pcall(dofile, wezterm.home_dir .. '/.pi/agent/extensions/pi-completion-notify/wezterm.lua')
if ok then completion.setup() end
```

Pi 执行 `/reload` 后生效。

## 自动初始化规则

- 仅支持 Windows x64；非 Windows 跳过初始化，不修改本机配置。
- 选择终端：`--terminal` → `PI_COMPLETION_TERMINALS` → 上次显式选择 → 自动检测。自动检测依据：WezTerm 的 `WEZTERM_EXECUTABLE`/配置文件/PATH；Windows Terminal 的 `WT_SESSION`/`WT_PROFILE_ID`/`wt.exe`/WindowsApps 别名。
- 显式选择会记入 `terminalSelection`；在同一安装目录内重复运行 `postinstall` 或无参数 setup 会沿用。`pi update` 会清理包目录里的 `data/`，选择可能丢失；更新前设置 `PI_COMPLETION_TERMINALS` 或更新后重新运行 setup。
- 只编译一个通知辅助程序 `CompletionToast.exe`；Windows Terminal 的窗口/标签页/pane 定位使用仓库内的 `windows/windows-terminal.ps1`，不新增可执行文件。
- 只有选择 WezTerm 时才修改 Lua 配置：`--config` → `WEZTERM_CONFIG_FILE` → XDG 或用户默认文件。发现多份候选配置时要求显式指定，不猜测当前生效文件。
- `-- BEGIN/END pi-completion-notify managed` 标记之间的块由 setup 维护，重复运行不重复插入，不改主题、字体和快捷键；路径使用 Lua 长字符串，不拼接可执行命令。
- 配置修改前原字节备份到 `data/backups/`；只接受 UTF-8，拒绝符号链接目标、损坏标记和并发修改。构建失败不修改 WezTerm 配置；快捷方式/编译产物可能已创建，修复后可重跑或使用卸载脚本移除。
- 检测到旧版手工 `pi-completion-notify/wezterm.lua` 加载段时停止，需用户先备份并移除该段再运行 setup；不会盲删用户 Lua。检测到其它位置的旧手动扩展时停止，需先归档并移走以免重复通知。
- 只选择 Windows Terminal 时，如果安装记录里还有旧 WezTerm 配置路径，setup 会备份并移除与本包内容一致的受管块；不会盲删用户 Lua。
- 没有 WezTerm 配置且选择了 WezTerm 时创建最小配置；不自动更改 Windows 通知权限、不发送测试通知、不关闭现有 Pi 进程。
- 安装记录写入 `data/installation.json`（v2，含 `terminals` 与 `terminalSelection`）：扩展启动时只对记录中的终端发送通知；记录缺失或旧版 v1 时为兼容老安装默认两个都启用。
- 卸载时删除受管标记块，不能把整个原配置覆盖回旧备份，避免丢失用户后续修改。

## 使用

```text
/completion-notify
/completion-notify status
/completion-notify test
```

输入 `/completion-notify `（末尾空格）可补全 `status`、`test`，并显示中文说明；无参数等同于 `status`。

`test` 立即发出带按钮的桌面通知，不执行 AI 或业务命令。切换到其它程序后点击按钮，验证是否切回原终端和最大化窗口。Windows Terminal 下优先尝试聚焦原分屏 pane；如果 pane 句柄/几何信息已失效，则降级为切回标签页。

## 工作方式与边界

- 监听 `agent_start` 和 `agent_settled`，不在每一轮工具执行或 `agent_end` 时通知，避免重试/压缩过程中误报。
- 通知表达“本轮执行已结束”，不是任务成功保证；错误、用户中止最终进入 settled 时同样可能提示，应打开终端看结果。
- 只在 Windows、已安装且启用的 WezTerm 或 Windows Terminal、交互 TUI 和真实 TTY 下发送；RPC/JSON/后台会话不污染输出。未在安装记录中的终端不发送。
- 每个 Pi 会话只保留最新一条通知，最长 10 分钟。新任务开始、退出或重载会话时清理旧通知和辅助程序。有效期之外的按钮不再处理。
- 通知只包含项目目录名和“pane N”/“Windows Terminal”标识，不发送命令正文、对话或模型答案；不创建日志。目录名仍可能包含业务信息，请注意系统通知可能在锁屏上展示。
- 辅助进程通过 stdin/stdout 与当前 Pi 通信，只返回固定 `open` 事件和随机通知 ID；不监听 HTTP，不注册退出后执行命令的 URL 协议。
- WezTerm：点击后使用固定 `wezterm cli --no-auto-start activate-pane --pane-id ...`，不将内容粘贴进终端，不创建新 pane，不按进程名猜测窗口。随后 OSC 用户变量使原 pane 对应的 Lua window 执行 maximize/focus。
- Windows Terminal：`session_start`/`agent_start` 通过 Windows PowerShell 5.1 + UI Automation 捕获窗口句柄、标签页序号/标题和当前 `TermControl` 的 runtime id/相对矩形；点击时由现有 Toast 程序预最大化/前置窗口，再调用 `windows/windows-terminal.ps1` 选择标签页并尽力 `SetFocus()` 原 pane。分屏 pane 定位失败时降级为标签页。
- Windows Terminal 检测依赖 `WT_SESSION`/`WT_PROFILE_ID` 或 `TERM_PROGRAM=Windows_Terminal`；如果 WT 只是作为 conhost 的默认终端且没有注入这些变量，可能无法识别。
- Windows Terminal 的 UIA 聚焦受完整性级别限制；终端与 Pi 不同级（例如管理员窗口）时可能无法切回，通知本身仍会显示。
- 标签页被重排、标题变化或分屏布局变化时，聚焦脚本按“标签序号 → 标题 → TermControl runtime id/相对矩形”多级匹配；仍失败则停在标签页或提示手动切换。
- Windows Terminal 的 `wt focus-pane --target` 需要每标签页内部的 pane 序号，外部进程拿不到；因此不使用该命令。WT 1.26 preview 的原生 OSC 777 通知暂不作为依赖。
- 新增的定位脚本是 `windows/windows-terminal.ps1`，不是编译产物；不新增开始菜单快捷方式或额外 `.exe`。
- 窗口只在点击后最大化和聚焦；当前窗口无论原先是普通大小还是最小化，都按最大化处理。Windows 仍可能限制前台激活。
- 系统通知权限、勿扰模式会影响显示；API ready 不等于用户看到了横幅。后台辅助程序退出后的旧通知不支持重新激活，这是为了避免过期 pane 和脱离原会话的操作。

## 开源与隐私

采用 [MIT License](LICENSE)。仓库仅包含源码、测试及通用安装说明，不包含本机 WezTerm 配置、开始菜单快捷方式、对话历史或已编译二进制。

`data/`、备份、日志、认证配置及 `windows/bin/` 均被 `.gitignore` 排除。辅助程序需要在本机构建，个人配置备份保留在本地，不应强制加入版本控制。仓库发布前的静态扫描不能替代后续提交的人工检查。

Windows Terminal 适配会读取当前焦点窗口句柄、标签页标题和 `TermControl` 几何信息，仅在内存中保存并传给本机聚焦脚本；不读取终端缓冲区内容、不落盘、不创建日志。

## 本地文件

- `windows/bin/CompletionToast.exe`：本机构建产物，Git 忽略。
- `windows/windows-terminal.ps1`：Windows Terminal 捕获/聚焦脚本，使用系统自带 Windows PowerShell 5.1 与 UI Automation，不是编译产物。
- `data/installation.json`：安装记录（启用的终端、显式/自动选择、WezTerm 配置路径），Git 忽略。
- `data/backups/`：已有通知快捷方式、WezTerm 配置等备份，Git 忽略。
- 开始菜单 `Pi Completion Notify.lnk`：独立 AppUserModelID `Pi.CompletionNotify`，不使用 WezTerm 或旧审批器身份。

无需 .NET SDK、NuGet、Electron 或第三方依赖；需要 Windows x64 的 .NET Framework 编译器及 WinRT 元数据。Windows Terminal 聚焦不需要额外编译产物，只需系统自带 Windows PowerShell 5.1。

## 测试

```bash
node --test tests/*.test.ts tests/*.test.mjs
wezterm --config-file <扩展绝对目录>/tests/wezterm.lua show-keys --lua
# Windows Terminal 适配自检（不切换焦点）：
powershell -NoProfile -ExecutionPolicy Bypass -File <扩展绝对目录>/windows/windows-terminal.ps1 selftest
```

测试不点击真实按钮。实机验收用 `/completion-notify test`，桌面按钮与分屏 pane/Tab 降级行为须人工验证。

## 统一卸载

先退出使用此插件的 Pi 会话，然后执行（`$pluginDir` 为实际安装目录）：

```powershell
npm --prefix "$pluginDir" run teardown -- --dry-run
npm --prefix "$pluginDir" run teardown
```

支持 `--config <绝对路径>`；默认优先使用 setup 记录在 `data/installation.json` 的配置路径和 `terminals` 列表。只选择 Windows Terminal 时跳过 WezTerm 配置清理。仅删除内容与当前包一致的受管块，不覆盖用户其它设置；快捷方式同时校验 AppID 和目标程序路径。标记损坏、其它安装接管或旧手工加载段会停止，需人工处理；部分系统资源可能已清理，可修复后重复执行。

teardown 会按安装记录备份修改前的 WezTerm 配置，并移除本包快捷方式与二进制；Windows Terminal 本身没有需要清理的配置。它会**保留源码及 data**。先把需要的 `data/` 归档到包目录之外，再卸载 Git 包：

```powershell
pi remove git:github.com/YangAoLib/pi-completion-notify
```

Pi 删除 Git 包不会调用卸载钩子，不能只执行 pi remove。手动克隆版则在 teardown 后移走目录。底层 `windows/uninstall.ps1 -WhatIf` 仍可单独预览系统资源清理，不处理 Lua。

### npm 安装脚本权限

不同 npm 版本、`ignore-scripts` 和依赖 `allowScripts` 策略会影响生命周期脚本。不能简单认为所有新版 npm 都禁用 postinstall，也不能将依赖审批警告等同于根项目脚本没有执行。若没有看到“初始化完成”，优先显式执行 `npm --prefix "$pluginDir" run setup -- --terminal <windows-terminal|wezterm|both>`；即使启用了 ignore-scripts，npm run 仍执行被明确指定的 setup，不执行前后置脚本。

不建议全局关闭脚本保护，也不使用 dangerously-allow-all-scripts。`pi install` 不保证透传 npm 专属参数，不能直接给它追加 --allow-scripts。
