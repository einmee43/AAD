--[[
    ====================================================================
    AA DROP TRACKER - LUA CLIENT (For Next.js + Supabase Dashboard)
    - Heartbeat every 45s (detects farming / lobby / frozen bots)
    - Tracks currency deltas + ResultsUI rewards on match completion
    - Non-blocking (wrapped in task.spawn + pcall)
    ====================================================================
]]

local cfg = getgenv().AA_TRACKER_CONFIG or {
    API_URL  = "https://YOUR_VERCEL_DOMAIN.vercel.app/api/ingest",
    API_KEY  = "PASTE_YOUR_API_KEY_HERE",
    BOT_NAME = "Bot 1"
}

local Players = game:GetService("Players")
local HttpService = game:GetService("HttpService")
local Workspace = game:GetService("Workspace")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local LocalPlayer = Players.LocalPlayer

local httpRequest = (syn and syn.request) or (http and http.request) or http_request or (fluxus and fluxus.request) or request
if not httpRequest then
    warn("[AA Tracker] Executor does not support HTTP requests!")
    return
end

local function postIngest(payload)
    task.spawn(function()
        pcall(function()
            payload.bot_name = cfg.BOT_NAME
            payload.roblox_username = LocalPlayer and LocalPlayer.Name or "Unknown"
            payload.roblox_user_id = LocalPlayer and LocalPlayer.UserId or 0

            httpRequest({
                Url = cfg.API_URL,
                Method = "POST",
                Headers = {
                    ["Content-Type"] = "application/json",
                    ["x-api-key"] = cfg.API_KEY
                },
                Body = HttpService:JSONEncode(payload)
            })
        end)
    end)
end

-- Scan ONLY useful player currencies: Gems, Gold, Summer Pearls
-- Returns (currenciesTable, isReadyBool)
local function readCurrencies()
    local currencies = {
        ["Gems"] = 0,
        ["Gold"] = 0,
        ["Summer Pearls"] = 0,
    }
    local ready = false
    pcall(function()
        local stats = LocalPlayer:FindFirstChild("_stats")
        if stats then
            local gemObj = stats:FindFirstChild("gem_amount")
            local goldObj = stats:FindFirstChild("gold_amount")
            local pearlObj = stats:FindFirstChild("_resourceSummerPearls")
            if gemObj and gemObj:IsA("ValueBase") then
                currencies["Gems"] = tonumber(gemObj.Value) or 0
                ready = true
            end
            if goldObj and goldObj:IsA("ValueBase") then
                currencies["Gold"] = tonumber(goldObj.Value) or 0
                ready = true
            end
            if pearlObj and pearlObj:IsA("ValueBase") then
                currencies["Summer Pearls"] = tonumber(pearlObj.Value) or 0
                ready = true
            end
        end
    end)
    return currencies, ready
end

-- Detect current game state (Lobby vs Farming + Wave/Map)
local function detectState()
    local isLobby = (game.PlaceId == 8304191830)
    local status = isLobby and "lobby" or "farming"
    local mode = isLobby and "Lobby" or "Match"
    local mapName = isLobby and "Main Lobby" or "In-Game"
    local waveStr = "-"

    pcall(function()
        local waveVal = Workspace:FindFirstChild("_wave_num", true) or Workspace:FindFirstChild("Wave", true)
        if waveVal and waveVal:IsA("ValueBase") then
            waveStr = "Wave " .. tostring(waveVal.Value)
        end
        local mapAttr = Workspace:GetAttribute("MapName") or Workspace:GetAttribute("LevelName")
        if mapAttr then mapName = tostring(mapAttr) end
        local modeAttr = Workspace:GetAttribute("GameMode") or Workspace:GetAttribute("Mode")
        if modeAttr then mode = tostring(modeAttr) end
    end)

    return status, mode, mapName, waveStr
end

-- Wait for _stats to load before taking initial snapshot (prevents reporting total balance as 1-run reward)
local startCurrencies, statsReady = readCurrencies()
local matchStartTime = os.time()
local sentForCurrentMatch = false

-- 1. Heartbeat loop (every 45s)
task.spawn(function()
    while true do
        local status, mode, mapName, waveStr = detectState()
        local cur, ready = readCurrencies()
        if ready and not statsReady then
            startCurrencies = cur
            statsReady = true
        end
        if ready then
            postIngest({
                event_type = "heartbeat",
                status = status,
                current_mode = mode,
                current_map = mapName,
                current_wave = waveStr,
                currencies = cur
            })
        end
        task.wait(45)
    end
end)

-- 2. ResultsUI & Match Completion Watcher
task.spawn(function()
    local pg = LocalPlayer:WaitForChild("PlayerGui", 15)
    if not pg then return end

    while true do
        pcall(function()
            local resultsUI = pg:FindFirstChild("ResultsUI")
            if resultsUI and resultsUI.Enabled and not sentForCurrentMatch then
                sentForCurrentMatch = true
                -- Wait 2s for server to finish crediting _stats after ResultsUI opens
                task.wait(2)
                local duration = math.max(1, os.time() - matchStartTime)
                local _, mode, mapName, _ = detectState()
                local endCurrencies, endReady = readCurrencies()

                local rewards = {}
                if statsReady and endReady then
                    for k, endVal in pairs(endCurrencies) do
                        local diff = endVal - (startCurrencies[k] or endVal)
                        if diff > 0 then
                            table.insert(rewards, {
                                name = k,
                                amount = diff,
                                category = "currency",
                                rarity = "common"
                            })
                        end
                    end
                end

                -- Scan ResultsUI labels for Win/Lose and LevelName
                local resultStatus = "Win"
                for _, obj in ipairs(resultsUI:GetDescendants()) do
                    if obj:IsA("TextLabel") and obj.Visible and #obj.Text > 0 then
                        local txt = obj.Text
                        local low = txt:lower()
                        if low:find("defeat") or low:find("lose") then
                            resultStatus = "Lose"
                        elseif obj.Name == "LevelName" or obj.Name == "MapName" then
                            mapName = txt
                        end
                    end
                end

                postIngest({
                    event_type = "run_complete",
                    mode = mode,
                    map_name = mapName,
                    result = resultStatus,
                    duration_sec = duration,
                    rewards = rewards,
                    currencies = endReady and endCurrencies or nil
                })
            elseif resultsUI and not resultsUI.Enabled and sentForCurrentMatch then
                -- Reset for next round (e.g. Replay pressed)
                sentForCurrentMatch = false
                matchStartTime = os.time()
                local cur, ready = readCurrencies()
                startCurrencies = cur
                statsReady = ready
            end
        end)
        task.wait(2)
    end
end)

print("[AA Tracker] Connected as " .. tostring(cfg.BOT_NAME))
