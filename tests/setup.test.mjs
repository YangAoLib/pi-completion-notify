import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectInstalledTerminals, mergeConfig, parseTerminalSelection, resolveConfig } from '../setup.mjs';
import path from 'node:path';

test('插入受管块，原主题与 return 保持不变，重复执行幂等', () => {
  const original = "local wezterm = require 'wezterm'\nlocal config = {}\nconfig.font_size = 14\nreturn config\n";
  const next = mergeConfig(original, '/plugin');
  assert.ok(next.endsWith(original));
  assert.equal(mergeConfig(next, '/plugin'), next);
  const moved = mergeConfig(next, '/other');
  assert.ok(moved.includes('/other/wezterm.lua'));
  assert.ok(!moved.includes('/plugin/wezterm.lua'));
});
test('保留 BOM 和 CRLF，兼容直接返回表的配置', () => {
  const next = mergeConfig('\uFEFFreturn {}\r\n', '/plugin');
  assert.ok(next.startsWith('\uFEFF-- BEGIN'));
  assert.ok(next.endsWith('return {}\r\n'));
  assert.equal(mergeConfig(next, '/plugin'), next);
});
test('路径含 Lua 特殊字符不能注入代码', () => {
  const next = mergeConfig('return {}', '/a"]];error("x")/b');
  assert.ok(next.includes('pcall(dofile, [=['));
});
test('拒绝旧手动加载和损坏标记，避免重复事件', () => {
  assert.throws(() => mergeConfig("dofile('/extensions/pi-completion-notify/wezterm.lua')", '/plugin'));
  assert.throws(() => mergeConfig('-- BEGIN pi-completion-notify managed\nreturn {}', '/plugin'));
  const block = mergeConfig('return {}', '/plugin');
  assert.throws(() => mergeConfig(block + block, '/plugin'));
});
test('配置来源优先环境变量，多份文件时不猜测', () => {
  const home = path.resolve('test-home');
  const explicit = path.join(home, 'custom.lua');
  assert.equal(resolveConfig({ WEZTERM_CONFIG_FILE: explicit }, home, () => true), explicit);
  assert.throws(() => resolveConfig({ WEZTERM_CONFIG_FILE: 'relative.lua' }, home, () => true));
  assert.throws(() => resolveConfig({}, home, () => true));
  assert.equal(resolveConfig({}, home, () => false), path.join(home, '.wezterm.lua'));
});
test('安装时可显式选择终端，both 展开为两个', () => {
  assert.deepEqual(parseTerminalSelection('windows-terminal'), ['windows-terminal']);
  assert.deepEqual(parseTerminalSelection('wezterm, windows-terminal'), ['wezterm', 'windows-terminal']);
  assert.deepEqual(parseTerminalSelection('both'), ['wezterm', 'windows-terminal']);
  assert.throws(() => parseTerminalSelection('unknown'));
  assert.throws(() => parseTerminalSelection(''));
});
test('未显式指定时按已安装应用自动检测', () => {
  const home = path.resolve('test-home');
  const wt = detectInstalledTerminals({ PATH: 'C:\\bin' }, home,
    () => false, name => name === 'wt.exe' ? 'C:\\bin\\wt.exe' : undefined);
  assert.deepEqual(wt, ['windows-terminal']);
  const wez = detectInstalledTerminals({ PATH: 'C:\\bin' }, home,
    location => location === path.join(home, '.wezterm.lua'), () => undefined);
  assert.deepEqual(wez, ['wezterm']);
  const wezConfig = path.join(home, '.wezterm.lua');
  const wtAlias = path.join(home, 'AppData', 'Local', 'Microsoft', 'WindowsApps', 'wt.exe');
  const both = detectInstalledTerminals({ PATH: '', LOCALAPPDATA: path.join(home, 'AppData', 'Local') }, home,
    location => location === wezConfig || location === wtAlias, () => undefined);
  assert.deepEqual(both, ['wezterm', 'windows-terminal']);
  assert.deepEqual(detectInstalledTerminals({ PATH: '', WT_SESSION: 'abc' }, home, () => false, () => undefined), ['windows-terminal']);
  assert.deepEqual(detectInstalledTerminals({ PATH: '' }, home, () => false, () => undefined), []);
});
