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
            for _, child in ipairs(stats:GetChildren()) do
                if child:IsA("ValueBase") then
                    local lname = child.Name:lower()
                    if lname:find("dawn") or lname:find("april") then
                        currencies["Dawn Coins"] = tonumber(child.Value) or 0
                        ready = true
                        break
                    end
                end
            end
        end

        local pg = LocalPlayer:FindFirstChild("PlayerGui")
        if pg then
            -- Dawn Coins: only read SummonGUI ResourceFrame if its icon is Dawn/April Coins (not SummerPearls/Gems)
            if currencies["Dawn Coins"] == nil then
                pcall(function()
                    local sg = pg:FindFirstChild("SummonGUI")
                    local main = sg and sg:FindFirstChild("Main")
                    local top = main and main:FindFirstChild("TopBar")
                    local cur = top and top:FindFirstChild("Currency")
                    local rf = cur and cur:FindFirstChild("ResourceFrame")
                    local lbl = rf and rf:FindFirstChild("Level")
                    local img = rf and (rf:FindFirstChildOfClass("ImageLabel") or rf:FindFirstChild("Icon"))
                    local imgStr = (img and img:IsA("ImageLabel") and img.Image) or ""
                    local isDawnIcon = imgStr:find("116671867490432") ~= nil
                    if lbl and lbl:IsA("TextLabel") and isDawnIcon then
                        local cleaned = lbl.Text:gsub(",", "")
                        local num = tonumber(cleaned)
                        if num then
                            currencies["Dawn Coins"] = num
                        end
                    elseif game.PlaceId == 8304191830 then
                        currencies["Dawn Coins"] = 0
                    end
                end)
            end

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

-- Scan inventory items from PlayerGui.items.grid.List.Outer.ItemFrames (and fallback folders)
local function readUsefulItems()
    local counts = {}
    local function inferRarity(rawName, idName)
        local low = (rawName .. " " .. (idName or "")):lower()
        if low:find("secret") or low:find("explosion") or low:find("demon") or low:find("perfect") or low:find("conqueror") or low:find("compass") then
            return "Secret"
        elseif low:find("portal") or low:find("cube") or low:find("remnant") or low:find("reroll") or low:find("key") or low:find("orb") or low:find("ball") or low:find("staff") or low:find("wings") then
            return "Mythic"
        else
            return "Legendary"
        end
    end

    local function addItem(rawName, amt, idName)
        if not rawName or type(rawName) ~= "string" then return end
        local trimmed = rawName:match("^%s*(.-)%s*$")
        if not trimmed or #trimmed == 0 then return end
        local low = trimmed:lower()
        if low == "portals" or low == "item" or low == "items" or low == "item name" or low:find("gift") then
            return
        end
        local key = trimmed
        if not counts[key] then
            counts[key] = { name = trimmed, amount = 0, rarity = inferRarity(trimmed, idName) }
        end
        counts[key].amount = counts[key].amount + (tonumber(amt) or 1)
    end

    pcall(function()
        local pg = LocalPlayer:FindFirstChild("PlayerGui")
        local itemsGui = pg and pg:FindFirstChild("items")
        local grid = itemsGui and itemsGui:FindFirstChild("grid")
        local list = grid and grid:FindFirstChild("List")
        local outer = list and list:FindFirstChild("Outer")
        local itemFrames = outer and outer:FindFirstChild("ItemFrames")
        if itemFrames then
            for _, frame in ipairs(itemFrames:GetChildren()) do
                if frame:IsA("GuiObject") and frame.Visible then
                    local nameLbl = frame:FindFirstChild("name") or frame:FindFirstChild("Title")
                    local mainFrame = frame:FindFirstChild("Main")
                    local qtyLbl = (mainFrame and mainFrame:FindFirstChild("Quantity")) or frame:FindFirstChild("Quantity") or frame:FindFirstChild("Amount")
                    if nameLbl and nameLbl:IsA("TextLabel") and #nameLbl.Text > 0 then
                        local q = 1
                        if qtyLbl and qtyLbl:IsA("TextLabel") then
                            q = tonumber((qtyLbl.Text:gsub("[^%d]", ""))) or 1
                        end
                        addItem(nameLbl.Text, q, frame.Name)
                    end
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

-- Detect current game state (Lobby vs Farming + Wave/Map + Dungeon Depth)
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

        -- Read from PlayerGui.Waves.HealthBar.LevelTitle when in-game
        local pg = LocalPlayer:FindFirstChild("PlayerGui")
        local waves = pg and pg:FindFirstChild("Waves")
        local hb = waves and waves:FindFirstChild("HealthBar")
        local lt = hb and hb:FindFirstChild("LevelTitle")
        if lt then
            local mLbl = lt:FindFirstChild("Map")
            local lLbl = lt:FindFirstChild("Level")
            if lLbl and lLbl:IsA("TextLabel") and #lLbl.Text > 0 then
                local lvlTxt = lLbl.Text
                if lvlTxt:lower():find("dungeon") or lvlTxt:lower():find("depth") then
                    mode = "Dungeon"
                end
                mapName = lvlTxt
            elseif mLbl and mLbl:IsA("TextLabel") and #mLbl.Text > 0 then
                mapName = mLbl.Text
            end
        end
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
                -- Wait 3.5s for server to finish crediting _stats after ResultsUI opens (especially Dungeon Rooms)
                task.wait(3.5)
                local duration = math.max(1, os.time() - matchStartTime)
                local _, mode, mapName, _ = detectState()
                local endCurrencies, endReady = readCurrencies()

                local rewards = {}
                local seenRewardNames = {}
                if statsReady and endReady then
                    for k, endVal in pairs(endCurrencies) do
                        if string.sub(k, 1, 1) ~= "_" then
                            local diff = endVal - (startCurrencies[k] or endVal)
                            if diff > 0 then
                                seenRewardNames[k:lower()] = true
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

                -- Scan ResultsUI labels for Win/Lose, LevelName, and Dungeon/Item Drops
                local resultStatus = "Win"
                for _, obj in ipairs(resultsUI:GetDescendants()) do
                    if obj:IsA("TextLabel") and obj.Visible and #obj.Text > 0 then
                        local txt = obj.Text
                        local low = txt:lower()
                        if low:find("defeat") or low:find("lose") then
                            resultStatus = "Lose"
                        elseif obj.Name == "LevelName" or obj.Name == "MapName" then
                            mapName = txt
                            if low:find("dungeon") or low:find("depth") then
                                mode = "Dungeon"
                            end
                        end
                    elseif obj:IsA("Frame") or obj:IsA("ImageButton") or obj:IsA("ImageLabel") then
                        -- Only treat as an item drop if it has an explicit item name + quantity label (never generic "Title" headers)
                        local nLbl = obj:FindFirstChild("name") or obj:FindFirstChild("ItemName")
                        local qLbl = obj:FindFirstChild("Amount") or obj:FindFirstChild("Quantity") or obj:FindFirstChild("RewardQuantity")
                        if nLbl and qLbl and nLbl:IsA("TextLabel") and qLbl:IsA("TextLabel") and #nLbl.Text > 0 and nLbl.Visible then
                            local itemName = nLbl.Text
                            local lowName = itemName:lower()
                            local isJunk = lowName:find("victory") or lowName:find("defeat") or lowName:find("score")
                                or lowName:find("first completion") or lowName:find("placeholder") or lowName:find("xp")
                                or lowName:find("bonus") or lowName:find("wave") or lowName:find("time")
                            if not isJunk and not seenRewardNames[lowName] then
                                local amt = tonumber((qLbl.Text:gsub("[^%d]", "")))
                                if amt and amt > 0 then
                                    local rarity = "Mythic"
                                    if lowName:find("secret") or lowName:find("portal") then rarity = "Secret"
                                    elseif lowName:find("reroll") or lowName:find("chest") then rarity = "Legendary" end
                                    seenRewardNames[lowName] = true
                                    table.insert(rewards, {
                                        name = itemName,
                                        amount = amt,
                                        category = "item",
                                        rarity = rarity
                                    })
                                end
                            end
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
