import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const BEGIN = '-- BEGIN pi-completion-notify managed';
const END = '-- END pi-completion-notify managed';

export function resolveConfig(env = process.env, home = os.homedir(), exists = fs.existsSync) {
  if (env.WEZTERM_CONFIG_FILE) {
    if (!path.isAbsolute(env.WEZTERM_CONFIG_FILE)) throw new Error('WEZTERM_CONFIG_FILE 必须是绝对路径');
    return env.WEZTERM_CONFIG_FILE;
  }
  const candidates = [path.join(env.XDG_CONFIG_HOME || path.join(home, '.config'), 'wezterm', 'wezterm.lua'), path.join(home, '.wezterm.lua')];
  const found = candidates.filter(exists);
  if (found.length > 1) throw new Error('发现多份 WezTerm 配置，请用 --config 指定当前生效文件');
  return found[0] || path.join(home, '.wezterm.lua');
}

export function mergeConfig(original, root) {
  const newline = original.includes('\r\n') ? '\r\n' : '\n';
  const integration = path.join(root, 'wezterm.lua').replaceAll('\\', '/');
  // Lua 长字符串避免 Windows 路径的转义问题；选择不会与路径冲突的分隔符。
  let eq = '=';
  while (integration.includes(']' + eq + ']')) eq += '=';
  const literal = '[' + eq + '[' + integration + ']' + eq + ']';
  const block = [BEGIN, 'do', `  local ok, completion = pcall(dofile, ${literal})`,
    '  if ok then completion.setup() else require("wezterm").log_warn("Pi completion integration unavailable") end',
    'end', END].join(newline);
  const starts = original.split(BEGIN).length - 1;
  const ends = original.split(END).length - 1;
  if (starts || ends) {
    if (starts !== 1 || ends !== 1 || original.indexOf(BEGIN) > original.indexOf(END)) throw new Error('受管配置标记损坏，请人工检查，未覆盖配置');
    const start = original.indexOf(BEGIN), end = original.indexOf(END) + END.length;
    const outside = original.slice(0, start) + original.slice(end);
    if (/pi-completion-notify[\\/]+wezterm\.lua/i.test(outside)) throw new Error('受管代码块外还有旧加载配置，请先移除重复加载段');
    return original.slice(0, start) + block + original.slice(end);
  }
  if (/pi-completion-notify[\\/]+wezterm\.lua/i.test(original)) throw new Error('检测到旧版手工加载段；请先备份并移除该段，再运行 npm run setup，避免重复事件');
  const bom = original.startsWith('\uFEFF') ? '\uFEFF' : '';
  // 插入文件头而不是猜测 return config 位置，兼容 return {...} 和模块式配置。
  return bom + block + newline + newline + original.slice(bom.length);
}

function checkDuplicate(root, agentDir) {
  const manual = path.join(agentDir, 'extensions', 'pi-completion-notify');
  if (fs.existsSync(path.join(manual, 'index.ts')) && fs.realpathSync(manual).toLowerCase() !== fs.realpathSync(root).toLowerCase()) {
    throw new Error('检测到 extensions/pi-completion-notify 手动安装版，请先归档并移走，避免两份扩展重复通知');
  }
}

export function setup(args = process.argv.slice(2)) {
  const postinstall = args.includes('--postinstall');
  try {
    if (process.platform !== 'win32') {
      console.log('当前插件仅支持 Windows；跳过桌面初始化，不修改系统配置。');
      return;
    }
    if (process.arch !== 'x64') throw new Error('当前自动构建仅支持 Windows x64');
    if (args.some((x, i) => !['--postinstall', '--config'].includes(x) && args[i - 1] !== '--config')) throw new Error('未知参数，支持 --config <WezTerm配置绝对路径>');
    const configIndex = args.indexOf('--config');
    const configPath = configIndex >= 0 ? args[configIndex + 1] : resolveConfig();
    if (!configPath || !path.isAbsolute(configPath)) throw new Error('--config 需要绝对路径');
    const agentDir = process.env.PI_CODING_AGENT_DIR || path.join(os.homedir(), '.pi', 'agent');
    checkDuplicate(ROOT, agentDir);
    const existed = fs.existsSync(configPath);
    // 不通过符号链接覆盖其它资源；用户需显式指定真实目标。
    if (existed && fs.lstatSync(configPath).isSymbolicLink()) throw new Error('配置为符号链接，请 --config 指定真实文件');
    const before = existed ? fs.readFileSync(configPath) : undefined;
    if (before?.includes(0)) throw new Error('配置不是 UTF-8 文本，请先转换编码');
    const text = before ? new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(before) : "local wezterm = require 'wezterm'\nreturn {}\n";
    const after = mergeConfig(text, ROOT);
    const changes = !before || after !== text;
    let backup;
    if (changes && before) {
      const dir = path.join(ROOT, 'data', 'backups');
      fs.mkdirSync(dir, { recursive: true });
      backup = path.join(dir, `wezterm-${Date.now()}-${randomUUID()}.lua`);
      fs.writeFileSync(backup, before, { flag: 'wx' });
    }
    // 先构建/注册，再改配置；失败时配置仍保持原样。使用脚本绝对路径，不拼接用户命令。
    const install = spawnSync('pwsh', ['-NoProfile', '-File', path.join(ROOT, 'windows', 'install.ps1')], { stdio: 'inherit', windowsHide: true });
    if (install.error || install.status !== 0) throw new Error('构建或快捷方式注册失败，请确认 PowerShell 7 可用、关闭旧通知后重试；WezTerm 配置未修改');
    if (changes) {
      if (before ? !fs.existsSync(configPath) || !fs.readFileSync(configPath).equals(before) : fs.existsSync(configPath)) throw new Error('配置在安装期间已变化，停止覆盖，请重新运行 setup');
      fs.mkdirSync(path.dirname(configPath), { recursive: true });
      const temp = configPath + '.pi-completion-' + randomUUID() + '.tmp';
      try { fs.writeFileSync(temp, after, { flag: 'wx' }); fs.renameSync(temp, configPath); }
      finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
    }
    console.log(`初始化完成：${configPath}。${backup ? '原配置已备份到扩展 data/backups。' : ''}`);
    console.log('请在已运行的 Pi 中 /reload，然后 /completion-notify test。');
  } catch (error) {
    console.error(`初始化未完成：${error instanceof Error ? error.message : String(error)}`);
    console.error(`修复入口：npm --prefix "${ROOT}" run setup -- --config "<当前WezTerm配置绝对路径>"`);
    // postinstall 不让已下载的包因本机 UI 环境失败而丢失；显式 setup 返回非零用于自动化检查。
    if (!postinstall) process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) setup();
