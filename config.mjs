import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';

export const BEGIN = '-- BEGIN pi-completion-notify managed';
export const END = '-- END pi-completion-notify managed';

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

export function removeManagedBlock(original, root) {
  const starts = original.split(BEGIN).length - 1, ends = original.split(END).length - 1;
  if (!starts && !ends) {
    if (/pi-completion-notify[\\/]+wezterm\.lua/i.test(original)) throw new Error('存在旧手工加载段，请人工核对并移除后重试；未改动配置');
    return original;
  }
  if (starts !== 1 || ends !== 1 || original.indexOf(BEGIN) > original.indexOf(END)) throw new Error('受管标记损坏，拒绝删除');
  // 只允许删除与当前包生成的内容完全一致的代码块，防止旧安装卸载新安装。
  if (mergeConfig(original, root) !== original) throw new Error('受管块已被修改或属于其它安装路径，拒绝删除');
  const start = original.indexOf(BEGIN);
  let end = original.indexOf(END) + END.length;
  const nl = original.includes('\r\n') ? '\r\n' : '\n';
  if (original.slice(end, end + nl.length * 2) === nl + nl) end += nl.length * 2;
  return original.slice(0, start) + original.slice(end);
}

export function writeConfigAtomic(configPath, expected, content) {
  if (expected !== undefined) {
    if (!fs.existsSync(configPath) || !fs.readFileSync(configPath).equals(expected)) {
      throw new Error('配置已被并发修改，停止覆盖，请重试');
    }
  } else if (fs.existsSync(configPath)) {
    throw new Error('配置在安装期间已变化，停止覆盖，请重新运行 setup');
  }
  const temp = configPath + '.pi-completion-' + randomUUID() + '.tmp';
  try {
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(temp, content, { flag: 'wx' });
    fs.renameSync(temp, configPath);
  } finally {
    if (fs.existsSync(temp)) fs.unlinkSync(temp);
  }
}
