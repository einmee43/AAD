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

-- Scan ONLY useful player currencies: Gems, Gold, Summer Pearls, Dawn Coins (+ Level/XP metadata)
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

        local pg = LocalPlayer:FindFirstChild("PlayerGui")
        if pg then
            -- Dawn Coins from SummonGUI.Main.TopBar.Currency.ResourceFrame.Level (only present/populated in Lobby)
            pcall(function()
                local sg = pg:FindFirstChild("SummonGUI")
                local main = sg and sg:FindFirstChild("Main")
                local top = main and main:FindFirstChild("TopBar")
                local cur = top and top:FindFirstChild("Currency")
                local rf = cur and cur:FindFirstChild("ResourceFrame")
                local lbl = rf and rf:FindFirstChild("Level")
                if lbl and lbl:IsA("TextLabel") then
                    local cleaned = lbl.Text:gsub(",", "")
                    local num = tonumber(cleaned)
                    if num and (num > 0 or game.PlaceId == 8304191830) then
                        currencies["Dawn Coins"] = num
                    end
                end
            end)

            -- Level & XP from exact paths: ProfileGUI.Main.ProfileBanner.XP.Desc.Level or spawn_units.Lives.Main.Desc.Level
            pcall(function()
                local candidates = {}
                local pGui = pg:FindFirstChild("ProfileGUI")
                if pGui then
                    local m = pGui:FindFirstChild("Main")
                    local pb = m and m:FindFirstChild("ProfileBanner")
                    local xpF = pb and pb:FindFirstChild("XP")
                    local desc = xpF and xpF:FindFirstChild("Desc")
                    local lbl = desc and desc:FindFirstChild("Level")
                    if lbl and lbl:IsA("TextLabel") then table.insert(candidates, lbl.Text) end
                end
                local su = pg:FindFirstChild("spawn_units")
                if su then
                    local lives = su:FindFirstChild("Lives")
                    local main = lives and lives:FindFirstChild("Main")
                    local desc = main and main:FindFirstChild("Desc")
                    local lbl = desc and desc:FindFirstChild("Level")
                    if lbl and lbl:IsA("TextLabel") then table.insert(candidates, lbl.Text) end
                end

                for _, txt in ipairs(candidates) do
                    local lv, curXp, maxXp = txt:match("Level%s+(%d+)%s*%[(%d+)/(%d+)%]")
                    local lvNum = tonumber(lv)
                    local maxNum = tonumber(maxXp)
                    if lvNum and lvNum > 0 and lvNum < 999 and maxNum ~= 999999 then
                        currencies["_level"] = lvNum
                        currencies["_xp"] = tonumber(curXp) or 0
                        currencies["_max_xp"] = maxNum or 100
                        break
                    end
                end
            end)
        end
    end)
    return currencies, ready
end

-- Scan useful inventory items (Portals, Stat Cubes, Rerolls, Star Remnants)
local function readUsefulItems()
    local counts = {}
    local function addItem(rawName, amt)
        if not rawName or type(rawName) ~= "string" then return end
        local low = rawName:lower()
        local rarity = "Mythic"
        if low:find("secret") or low:find("explosion") or low:find("demon") then
            rarity = "Secret"
        elseif low:find("reroll") or low:find("legendary") then
            rarity = "Legendary"
        end
        if low:find("portal") or low:find("cube") or low:find("remnant") or low:find("reroll") then
            local key = rawName
            if not counts[key] then
                counts[key] = { name = rawName, amount = 0, rarity = rarity }
            end
            counts[key].amount = counts[key].amount + (tonumber(amt) or 1)
        end
    end

    pcall(function()
        for _, child in ipairs(LocalPlayer:GetChildren()) do
            local cname = child.Name:lower()
            if cname:find("item") or cname:find("invent") or cname:find("bag") then
                for _, sub in ipairs(child:GetChildren()) do
                    local qty = sub:IsA("ValueBase") and tonumber(sub.Value) or 1
                    addItem(sub.Name, qty)
                end
            end
        end
    end)

    local list = {}
    for _, v in pairs(counts) do
        table.insert(list, v)
    end
    return list
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
                currencies = cur,
                items = readUsefulItems()
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
                        if string.sub(k, 1, 1) ~= "_" then
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
