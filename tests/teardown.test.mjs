import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeConfig } from '../setup.mjs';
import { removeManagedBlock } from '../teardown.mjs';

test('仅移除本包受管块，保留原文和用户后续修改', () => {
  const original = "local config = {}\nreturn config\n";
  const added = mergeConfig(original, '/plugin') + '-- 用户后续注释\n';
  assert.equal(removeManagedBlock(added, '/plugin'), original + '-- 用户后续注释\n');
});
test('BOM、CRLF 和重复卸载保持稳定', () => {
  const original = '\uFEFFreturn {}\r\n';
  const result = removeManagedBlock(mergeConfig(original, '/plugin'), '/plugin');
  assert.equal(result, original);
  assert.equal(removeManagedBlock(result, '/plugin'), original);
});
test('其它安装、篡改代码块和手工配置不盲删', () => {
  const managed = mergeConfig('return {}', '/other');
  assert.throws(() => removeManagedBlock(managed, '/plugin'));
  assert.throws(() => removeManagedBlock(managed.replace('completion.setup()', 'custom()'), '/other'));
  assert.throws(() => removeManagedBlock('-- BEGIN pi-completion-notify managed', '/plugin'));
  assert.throws(() => removeManagedBlock("dofile('/old/pi-completion-notify/wezterm.lua')", '/plugin'));
});
