local wezterm = require 'wezterm'
local M = {}

function M.setup()
  wezterm.on('user-var-changed', function(window, pane, name, value)
    if name ~= 'PI_COMPLETION_FOCUS' or #value > 2048 then return end
    local ok, request = pcall(wezterm.json_parse, value)
    local raw = (pane:get_user_vars() or {}).PI_COMPLETION_STATE
    if not ok or type(request) ~= 'table' or not raw or #raw > 2048 then return end
    local valid, state = pcall(wezterm.json_parse, raw)
    local now = os.time() * 1000
    if not valid or type(state) ~= 'table' or type(request.id) ~= 'string' or state.id ~= request.id
        or type(state.deadline) ~= 'number' or state.deadline <= now or request.deadline ~= state.deadline
        or type(request.requestedAt) ~= 'number' or request.requestedAt > now + 2000
        or now - request.requestedAt > 5000 then return end
    -- 只在用户点击后最大化并聚焦所属窗口，不使用会还原普通尺寸的 restore()。
    window:maximize()
    window:focus()
  end)
end

return M
