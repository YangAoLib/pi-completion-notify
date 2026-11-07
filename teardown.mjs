import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { removeManagedBlock, resolveConfig, writeConfigAtomic } from './config.mjs';

export { removeManagedBlock } from './config.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(args) {
  const options = { dryRun: false, config: undefined };
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--config') {
      const value = args[++index];
      if (!value) throw new Error('--config 缺少参数值');
      options.config = value;
    } else {
      throw new Error('支持 --dry-run、--config <绝对路径>');
    }
  }
  return options;
}

function readInstallation() {
  try {
    const value = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'installation.json'), 'utf8'));
    return value && typeof value === 'object' ? value : undefined;
  } catch {
    return undefined;
  }
}

export function teardown(args = process.argv.slice(2)) {
  try {
    const options = parseArgs(args);
    const record = readInstallation();
    const recordTerminals = Array.isArray(record?.terminals) ? record.terminals : undefined;
    const recordConfig = typeof record?.configPath === 'string' ? record.configPath : undefined;

    let configPath;
    if (options.config) configPath = options.config;
    else if (recordConfig) configPath = recordConfig;
    else if (!record || !recordTerminals) {
      try { configPath = resolveConfig(); } catch { configPath = undefined; }
    }
    if (configPath && !path.isAbsolute(configPath)) throw new Error('配置路径必须为绝对路径');
    if (configPath && fs.existsSync(configPath) && fs.lstatSync(configPath).isSymbolicLink()) throw new Error('请指定配置的真实文件路径');

    const before = configPath && fs.existsSync(configPath) ? fs.readFileSync(configPath) : undefined;
    if (before?.includes(0)) throw new Error('只处理 UTF-8 配置');
    const text = before ? new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(before) : '';
    const after = configPath ? removeManagedBlock(text, ROOT) : text;
    console.log(`${options.dryRun ? '预览' : '卸载'}：${configPath ? (after === text ? '配置不需要变更' : '移除本包受管配置块') : '未记录 WezTerm 配置，跳过配置清理'}；${configPath ?? '仅清理系统资源'}`);

    if (process.platform !== 'win32') {
      if (options.dryRun) return;
      throw new Error('系统资源卸载仅支持 Windows');
    }
    // PowerShell 自身校验快捷方式目标，预览同样执行只读检查。
    const command = spawnSync('pwsh', ['-NoProfile', '-File', path.join(ROOT, 'windows', 'uninstall.ps1'), ...(options.dryRun ? ['-WhatIf'] : [])], { stdio: 'inherit', windowsHide: true });
    if (command.error || command.status !== 0) throw new Error('系统资源卸载失败，配置保持原样，请处理占用或路径冲突后重试');
    if (options.dryRun) return;
    if (before && after !== text) {
      const dir = path.join(ROOT, 'data', 'backups');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, `wezterm-uninstall-${Date.now()}-${randomUUID()}.lua`), before, { flag: 'wx' });
      writeConfigAtomic(configPath, before, after);
    }
    const recordPath = path.join(ROOT, 'data', 'installation.json');
    if (fs.existsSync(recordPath)) fs.unlinkSync(recordPath);
    console.log(`系统资源和受管配置已清理；源码与 data 仍保留。${configPath ? 'WezTerm 配置已按记录检查。' : '未启用 WezTerm，跳过其配置清理。'}先归档 data 到包目录外，再执行 pi remove。`);
  } catch (error) {
    console.error(`卸载未完成：${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) teardown();
