import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mergeConfig, resolveConfig } from './setup.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const BEGIN = '-- BEGIN pi-completion-notify managed';
const END = '-- END pi-completion-notify managed';

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

export function teardown(args = process.argv.slice(2)) {
  try {
    const dryRun = args.includes('--dry-run');
    if (args.some((x, i) => !['--dry-run', '--config'].includes(x) && args[i - 1] !== '--config')) throw new Error('支持 --dry-run、--config <绝对路径>');
    const recordPath = path.join(ROOT, 'data', 'installation.json');
    const record = fs.existsSync(recordPath) ? JSON.parse(fs.readFileSync(recordPath, 'utf8')) : undefined;
    const index = args.indexOf('--config');
    const configPath = index >= 0 ? args[index + 1] : record?.configPath ?? resolveConfig();
    if (!configPath || !path.isAbsolute(configPath)) throw new Error('配置路径必须为绝对路径');
    if (fs.existsSync(configPath) && fs.lstatSync(configPath).isSymbolicLink()) throw new Error('请指定配置的真实文件路径');
    const before = fs.existsSync(configPath) ? fs.readFileSync(configPath) : undefined;
    if (before?.includes(0)) throw new Error('只处理 UTF-8 配置');
    const text = before ? new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(before) : '';
    const after = removeManagedBlock(text, ROOT);
    console.log(`${dryRun ? '预览' : '卸载'}：${after === text ? '配置不需要变更' : '移除本包受管配置块'}；${configPath}`);
    if (process.platform !== 'win32') { if (dryRun) return; throw new Error('系统资源卸载仅支持 Windows'); }
    // PowerShell 自身校验快捷方式目标，预览同样执行只读检查。
    const command = spawnSync('pwsh', ['-NoProfile', '-File', path.join(ROOT, 'windows', 'uninstall.ps1'), ...(dryRun ? ['-WhatIf'] : [])], { stdio: 'inherit', windowsHide: true });
    if (command.error || command.status !== 0) throw new Error('系统资源卸载失败，配置保持原样，请处理占用或路径冲突后重试');
    if (dryRun) return;
    if (before && after !== text) {
      if (!fs.existsSync(configPath) || !fs.readFileSync(configPath).equals(before)) throw new Error('配置已被并发修改，保留配置，请重试');
      const dir = path.join(ROOT, 'data', 'backups');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, `wezterm-uninstall-${Date.now()}-${randomUUID()}.lua`), before, { flag: 'wx' });
      const temp = configPath + '.pi-completion-' + randomUUID() + '.tmp';
      try { fs.writeFileSync(temp, after, { flag: 'wx' }); fs.renameSync(temp, configPath); }
      finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
    }
    if (fs.existsSync(recordPath)) fs.unlinkSync(recordPath);
    console.log('系统资源和受管配置已清理；源码与 data 仍保留。先归档 data 到包目录外，再执行 pi remove。');
  } catch (error) {
    console.error(`卸载未完成：${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) teardown();
