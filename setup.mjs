import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mergeConfig, removeManagedBlock, resolveConfig, writeConfigAtomic } from './config.mjs';

export { mergeConfig, resolveConfig } from './config.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const TERMINALS = ['wezterm', 'windows-terminal'];
const LABELS = { wezterm: 'WezTerm', 'windows-terminal': 'Windows Terminal' };

export function parseTerminalSelection(value, source = '--terminal') {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${source} 需要 wezterm、windows-terminal 或 both`);
  const parts = value.split(',').map(item => item.trim().toLowerCase()).filter(Boolean);
  if (!parts.length) throw new Error(`${source} 需要 wezterm、windows-terminal 或 both`);
  const selected = new Set();
  for (const part of parts) {
    if (part === 'both') {
      for (const terminal of TERMINALS) selected.add(terminal);
    } else if (TERMINALS.includes(part)) {
      selected.add(part);
    } else {
      throw new Error(`未知终端：${part}；支持 wezterm、windows-terminal、both`);
    }
  }
  return TERMINALS.filter(terminal => selected.has(terminal));
}

export function findOnPath(name, env = process.env, exists = fs.existsSync) {
  const dirs = (env.PATH || '').split(path.delimiter).filter(Boolean);
  for (const dir of dirs) {
    const candidate = path.join(dir, name);
    if (exists(candidate)) return candidate;
  }
  return undefined;
}

export function detectInstalledTerminals(env = process.env, home = os.homedir(), exists = fs.existsSync, find = findOnPath) {
  const configCandidates = [
    path.join(env.XDG_CONFIG_HOME || path.join(home, '.config'), 'wezterm', 'wezterm.lua'),
    path.join(home, '.wezterm.lua'),
  ];
  const wezterm = Boolean(
    (env.WEZTERM_EXECUTABLE && exists(env.WEZTERM_EXECUTABLE)) ||
    (env.WEZTERM_CONFIG_FILE && exists(env.WEZTERM_CONFIG_FILE)) ||
    configCandidates.some(exists) ||
    find('wezterm.exe', env, exists)
  );
  const windowsTerminal = Boolean(
    env.WT_SESSION?.trim() ||
    env.WT_PROFILE_ID?.trim() ||
    find('wt.exe', env, exists) ||
    exists(path.join(env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'Microsoft', 'WindowsApps', 'wt.exe'))
  );
  return TERMINALS.filter(terminal => terminal === 'wezterm' ? wezterm : windowsTerminal);
}

function parseArgs(args) {
  const options = { postinstall: false, config: undefined, terminal: undefined };
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--postinstall') {
      options.postinstall = true;
    } else if (arg === '--config' || arg === '--terminal') {
      const value = args[++index];
      if (!value) throw new Error(`${arg} 缺少参数值`);
      if (arg === '--config') options.config = value;
      else options.terminal = value;
    } else {
      throw new Error('未知参数，支持 --postinstall、--config <绝对路径>、--terminal <终端>');
    }
  }
  return options;
}

function readInstallation(root = ROOT) {
  try {
    const value = JSON.parse(fs.readFileSync(path.join(root, 'data', 'installation.json'), 'utf8'));
    return value && typeof value === 'object' ? value : undefined;
  } catch {
    return undefined;
  }
}

function backupConfig(before) {
  const dir = path.join(ROOT, 'data', 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const backup = path.join(dir, `wezterm-${Date.now()}-${randomUUID()}.lua`);
  fs.writeFileSync(backup, before, { flag: 'wx' });
  return backup;
}

function checkDuplicate(root, agentDir) {
  const manual = path.join(agentDir, 'extensions', 'pi-completion-notify');
  if (fs.existsSync(path.join(manual, 'index.ts')) && fs.realpathSync(manual).toLowerCase() !== fs.realpathSync(root).toLowerCase()) {
    throw new Error('检测到 extensions/pi-completion-notify 手动安装版，请先归档并移走，避免两份扩展重复通知');
  }
}

function buildHelpers() {
  // 先构建/注册，再改配置；失败时配置仍保持原样。使用脚本绝对路径，不拼接用户命令。
  const install = spawnSync('pwsh', ['-NoProfile', '-File', path.join(ROOT, 'windows', 'install.ps1')], { stdio: 'inherit', windowsHide: true });
  if (install.error || install.status !== 0) {
    throw new Error('构建或快捷方式注册失败，请确认 PowerShell 7 可用、关闭旧通知后重试；WezTerm 配置未修改');
  }
}

export function setup(args = process.argv.slice(2)) {
  let postinstall = false;
  try {
    const options = parseArgs(args);
    postinstall = options.postinstall;
    if (process.platform !== 'win32') {
      console.log('当前插件仅支持 Windows；跳过桌面初始化，不修改系统配置。');
      return;
    }
    if (process.arch !== 'x64') throw new Error('当前自动构建仅支持 Windows x64');

    const previous = readInstallation();
    const envSelection = process.env.PI_COMPLETION_TERMINALS?.trim();
    const source = options.terminal !== undefined ? '--terminal' : 'PI_COMPLETION_TERMINALS';
    const explicit = options.terminal !== undefined || Boolean(envSelection);
    let selectionSource = explicit ? 'explicit' : 'auto';
    let selected;
    if (explicit) {
      selected = parseTerminalSelection(options.terminal ?? envSelection, source);
    } else if (previous?.version === 2 && previous.terminalSelection === 'explicit' && Array.isArray(previous.terminals)) {
      selected = TERMINALS.filter(terminal => previous.terminals.includes(terminal));
      if (!selected.length) { selected = detectInstalledTerminals(); selectionSource = 'auto'; }
      else { selectionSource = 'explicit'; console.log('沿用上次安装的终端选择；如需变更请使用 --terminal。'); }
    } else {
      selected = detectInstalledTerminals();
    }
    if (!selected.length) {
      throw new Error('未检测到 WezTerm 或 Windows Terminal；如已安装，请用 --terminal wezterm、windows-terminal 或 both 指定');
    }
    if (options.config && !selected.includes('wezterm')) {
      throw new Error('--config 仅用于 WezTerm；当前未选择 WezTerm');
    }

    const agentDir = process.env.PI_CODING_AGENT_DIR || path.join(os.homedir(), '.pi', 'agent');
    checkDuplicate(ROOT, agentDir);

    let configPath;
    let before;
    let after;
    const previousConfig = typeof previous?.configPath === 'string' ? previous.configPath : undefined;
    if (selected.includes('wezterm')) {
      configPath = options.config ?? previousConfig ?? resolveConfig();
      if (!path.isAbsolute(configPath)) throw new Error('WezTerm 配置必须是绝对路径');
      const existed = fs.existsSync(configPath);
      // 不通过符号链接覆盖其它资源；用户需显式指定真实目标。
      if (existed && fs.lstatSync(configPath).isSymbolicLink()) throw new Error('配置为符号链接，请 --config 指定真实文件');
      before = existed ? fs.readFileSync(configPath) : undefined;
      if (before?.includes(0)) throw new Error('配置不是 UTF-8 文本，请先转换编码');
      const text = before ? new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(before) : "local wezterm = require 'wezterm'\nreturn {}\n";
      after = mergeConfig(text, ROOT);
    } else if (previousConfig && fs.existsSync(previousConfig)) {
      configPath = previousConfig;
      if (fs.lstatSync(configPath).isSymbolicLink()) throw new Error('旧安装记录的 WezTerm 配置是符号链接，请手动处理');
      before = fs.readFileSync(configPath);
      if (before.includes(0)) throw new Error('旧安装记录的 WezTerm 配置不是 UTF-8，请手动处理');
      const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(before);
      after = removeManagedBlock(text, ROOT);
    }

    const changes = Boolean(configPath && (before === undefined || after !== textOf(before)));
    const backup = changes && before ? backupConfig(before) : undefined;
    buildHelpers();
    if (changes && configPath) writeConfigAtomic(configPath, before, after);

    fs.mkdirSync(path.join(ROOT, 'data'), { recursive: true });
    fs.writeFileSync(path.join(ROOT, 'data', 'installation.json'), JSON.stringify({
      version: 2,
      root: ROOT,
      terminals: selected,
      terminalSelection: selectionSource,
      configPath: selected.includes('wezterm') ? configPath : null,
    }, null, 2) + '\n');
    const labels = selected.map(terminal => LABELS[terminal]).join('、');
    console.log(`初始化完成：已启用 ${labels}。${backup ? '原配置已备份到扩展 data/backups。' : ''}`);
    if (selected.includes('windows-terminal')) console.log('Windows Terminal 无需修改终端配置；点击通知会尝试定位分屏 pane，失败则打开标签页。');
    if (configPath && !selected.includes('wezterm') && changes) console.log('已移除旧 WezTerm 受管配置块。');
    console.log('请在已运行的 Pi 中 /reload，然后 /completion-notify test。');
  } catch (error) {
    console.error(`初始化未完成：${error instanceof Error ? error.message : String(error)}`);
    console.error(`修复入口：npm --prefix "${ROOT}" run setup -- --terminal <windows-terminal|wezterm|both>；WezTerm 可再加 --config "<绝对路径>"`);
    // postinstall 不让已下载的包因本机 UI 环境失败而丢失；显式 setup 返回非零用于自动化检查。
    if (!postinstall) process.exitCode = 1;
  }
}

function textOf(buffer) {
  return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(buffer);
}


if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) setup();
