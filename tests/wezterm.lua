local real = require 'wezterm'
local handlers = {}
package.loaded.wezterm = { on = function(name, fn) handlers[name] = fn end, json_parse = real.json_parse }
local here = debug.getinfo(1, 'S').source:sub(2):match('^(.*)[/\\]')
dofile(here .. '/../wezterm.lua').setup()
package.loaded.wezterm = real
local deadline = (os.time() + 60) * 1000
local calls = {}
local window = { maximize = function() table.insert(calls, 'maximize') end, focus = function() table.insert(calls, 'focus') end }
local pane = { get_user_vars = function() return { PI_COMPLETION_STATE = real.json_encode({ id = 'a', deadline = deadline }) } end }
local value = { id = 'a', deadline = deadline, requestedAt = os.time() * 1000 }
handlers['user-var-changed'](window, pane, 'PI_COMPLETION_FOCUS', real.json_encode(value))
assert(table.concat(calls, ',') == 'maximize,focus')
value.id = 'wrong'
handlers['user-var-changed'](window, pane, 'PI_COMPLETION_FOCUS', real.json_encode(value))
value.id = 'a'
value.requestedAt = (os.time() - 10) * 1000
handlers['user-var-changed'](window, pane, 'PI_COMPLETION_FOCUS', real.json_encode(value))
assert(#calls == 2)
return {}
