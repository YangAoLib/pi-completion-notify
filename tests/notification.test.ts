import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { safeLabel, validClick, variable } from '../notification.ts';
import { detectTerminal, fallbackTabName, parseFocusResult, parseWindowsTerminalTarget, readInstalledTerminals } from '../terminal.ts';
import extension from '../index.ts';

const ALL = new Set<'wezterm' | 'windows-terminal'>(['wezterm', 'windows-terminal']);

test('只接受匹配且未过期的打开事件', () => {
  assert.equal(validClick({ kind: 'open', id: 'a' }, 'a', 200, 100), true);
  assert.equal(validClick({ kind: 'open', id: 'b' }, 'a', 200, 100), false);
  assert.equal(validClick({ kind: 'execute', id: 'a' }, 'a', 200, 100), false);
  assert.equal(validClick({ kind: 'open', id: 'a' }, 'a', 200, 200), false);
  assert.equal(validClick(null, 'a', 200, 100), false);
});
test('标题过滤控制字符并限制长度', () => {
  assert.ok(!/[;\x00-\x1f]/.test(safeLabel('测试;\x1b]9;hello\x07')));
  assert.equal(Array.from(safeLabel('中'.repeat(100))).length, 70);
});
test('OSC 用户变量使用 base64 防止内容注入', () => {
  const encoded = variable('PI_COMPLETION_STATE', { id: 'a', deadline: 1 });
  assert.ok(encoded.startsWith('\x1b]1337;SetUserVar=PI_COMPLETION_STATE='));
  const data = encoded.split('PI_COMPLETION_STATE=')[1].slice(0, -1);
  assert.deepEqual(JSON.parse(Buffer.from(data, 'base64').toString()), { id: 'a', deadline: 1 });
});
test('识别已安装且当前正在使用的终端', () => {
  const wez = { TERM_PROGRAM: 'WezTerm', WEZTERM_PANE: '14' };
  const wt = { WT_SESSION: 'd728ee70-3763-4bc1-976f-c4a49f419ca7' };
  assert.equal(detectTerminal('tui', wez, true, ALL, 'win32'), 'wezterm');
  assert.equal(detectTerminal('tui', wt, true, ALL, 'win32'), 'windows-terminal');
  assert.equal(detectTerminal('tui', { ...wez, ...wt }, true, ALL, 'win32'), 'wezterm');
  assert.equal(detectTerminal('tui', wt, true, new Set(['wezterm']), 'win32'), null);
  assert.equal(detectTerminal('tui', wez, true, new Set(['windows-terminal']), 'win32'), null);
  for (const mode of ['rpc', 'json', 'print']) assert.equal(detectTerminal(mode, wt, true, ALL, 'win32'), null);
  assert.equal(detectTerminal('tui', wt, false, ALL, 'win32'), null);
  assert.equal(detectTerminal('tui', wt, true, ALL, 'linux'), null);
});
test('Windows Terminal 捕获数据经过严格校验', () => {
  const valid = {
    ok: true, version: 1, hwnd: 265354, tabIndex: 0,
    tabName: 'π - pi-completion-notify', termRuntimeId: [42, 396316, 4, 70],
    termRect: [0, 0.03, 1, 0.95], capturedAt: 1730000000000,
  };
  assert.deepEqual(parseWindowsTerminalTarget(valid), {
    version: 1, hwnd: 265354, tabIndex: 0, tabName: 'π - pi-completion-notify',
    termRuntimeId: [42, 396316, 4, 70], termRect: [0, 0.03, 1, 0.95], capturedAt: 1730000000000,
  });
  assert.equal(parseWindowsTerminalTarget({ ...valid, hwnd: -1 }), null);
  assert.equal(parseWindowsTerminalTarget({ ...valid, tabName: 'x'.repeat(513) }), null);
  assert.equal(parseWindowsTerminalTarget({ ...valid, termRuntimeId: [] }), null);
  assert.equal(parseWindowsTerminalTarget({ ...valid, termRect: [0, 1, 2] }), null);
  assert.equal(parseWindowsTerminalTarget(null), null);
  assert.equal(parseWindowsTerminalTarget({ ...valid, version: 2 }), null);
});
test('聚焦结果区分标签页与分屏 pane', () => {
  assert.deepEqual(parseFocusResult({ ok: true, tabSelected: true, paneFocused: false }), {
    ok: true, tabSelected: true, paneFocused: false, reason: undefined,
  });
  assert.equal(parseFocusResult({ ok: false, tabSelected: false, reason: 'window-not-found' }).reason, 'window-not-found');
  assert.throws(() => parseFocusResult(null));
});
test('回退标签标题使用项目目录名', () => {
  assert.match(fallbackTabName('/tmp/demo'), /demo$/);
});
test('安装记录只启用选中的终端，旧记录保持兼容', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pi-notify-'));
  try {
    const file = join(dir, 'installation.json');
    writeFileSync(file, JSON.stringify({ version: 2, terminals: ['windows-terminal'] }));
    assert.deepEqual([...readInstalledTerminals(file)], ['windows-terminal']);
    writeFileSync(file, JSON.stringify({ version: 1, configPath: 'x' }));
    assert.deepEqual([...readInstalledTerminals(file)], ['wezterm', 'windows-terminal']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test('子命令补全包含中文说明并支持前缀过滤', async () => {
  let command: any;
  extension({ on() {}, registerCommand(_name: string, definition: any) { command = definition; } } as any);
  assert.deepEqual(command.getArgumentCompletions('').map((item: any) => item.value), ['status', 'test']);
  assert.deepEqual(command.getArgumentCompletions('te').map((item: any) => item.value), ['test']);
  assert.equal(command.getArgumentCompletions('unknown'), null);
  const messages: any[] = [];
  const ctx = { mode: 'print', cwd: process.cwd(), ui: { notify(text: string, level: string) { messages.push({ text, level }); } } };
  await command.handler('status', ctx);
  assert.equal(messages.at(-1).level, 'info');
  await command.handler('invalid', ctx);
  assert.equal(messages.at(-1).level, 'warning');
});
test('只监听最终 settled，不在单轮 agent_end 通知', async () => {
  const handlers = new Map<string, Function>();
  extension({ on: (name: string, fn: Function) => handlers.set(name, fn), registerCommand() {} } as any);
  assert.ok(handlers.has('agent_settled'));
  assert.equal(handlers.has('agent_end'), false);
  await handlers.get('session_start')!({}, { mode: 'print', cwd: process.cwd() });
  await handlers.get('agent_start')!({}, { mode: 'print', cwd: process.cwd() });
  await handlers.get('agent_settled')!({}, { mode: 'print', cwd: process.cwd() });
  await handlers.get('agent_settled')!({}, { mode: 'print', cwd: process.cwd() });
  await handlers.get('session_shutdown')!();
});
