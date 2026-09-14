import { test } from 'node:test';
import assert from 'node:assert/strict';
import { safeLabel, validClick, variable, supportsNotification } from '../notification.ts';
import extension from '../index.ts';

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
test('不在 RPC、无 TTY 或非 WezTerm 输出通知', () => {
  const env = { TERM_PROGRAM: 'WezTerm', WEZTERM_PANE: '14' };
  for (const mode of ['rpc', 'json', 'print']) assert.equal(supportsNotification(mode, env, true), false);
  assert.equal(supportsNotification('tui', env, false), false);
  assert.equal(supportsNotification('tui', { TERM_PROGRAM: 'other' }, true), false);
});
test('子命令补全包含中文说明并支持前缀过滤', async () => {
  let command: any;
  extension({ on() {}, registerCommand(_name: string, definition: any) { command = definition; } } as any);
  assert.deepEqual(command.getArgumentCompletions('').map((item: any) => item.value), ['status', 'test']);
  assert.deepEqual(command.getArgumentCompletions('te').map((item: any) => item.value), ['test']);
  assert.equal(command.getArgumentCompletions('unknown'), null);
  const messages: any[] = [];
  const ctx = { ui: { notify(text: string, level: string) { messages.push({ text, level }); } } };
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
  await handlers.get('session_start')!();
  await handlers.get('agent_start')!();
  await handlers.get('agent_settled')!({}, { mode: 'print' });
  await handlers.get('agent_settled')!({}, { mode: 'print' });
  await handlers.get('session_shutdown')!();
});
