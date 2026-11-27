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

-- Master metadata loaders & complete RAM inventory + units collection scanner (bypasses virtual scroll limits)
local cachedGcPortals = {}
local cachedGcItems = {}
local cachedGcUnits = {}
local cachedTraitRerolls = nil
local cachedTotalTraitRerolls = nil
local cachedStarRemnants = nil
local cachedBattlePass = nil
local cachedTowerData = nil
local cachedActiveTowerRoom = nil
local cachedActiveEventFloor = nil
local cachedProfileCur = {}

local function readTowerGuiInfo()
    local info = {}
    pcall(function()
        local pg = LocalPlayer and LocalPlayer:FindFirstChild("PlayerGui")
        if not pg then return end
        local itUi = pg:FindFirstChild("InfiniteTowerUI")
        local ls = itUi and itUi:FindFirstChild("LevelSelect")
        local top = ls and ls:FindFirstChild("Top")
        local topTitle = top and top:FindFirstChild("Title")
        if topTitle and topTitle:IsA("TextLabel") then
            local txt = tostring(topTitle.Text or ""):gsub("<[^>]+>", "")
            local sMatch = txt:match("%((Season%s*%d+)%)") or txt:match("(Season%s*%d+)")
            if sMatch then info.season = sMatch end
        end

        local rkUi = pg:FindFirstChild("InfinityCastleRankingUI")
        local m1 = rkUi and rkUi:FindFirstChild("Main")
        local m2 = m1 and m1:FindFirstChild("Main")
        local sc = m2 and m2:FindFirstChild("Scroll")
        local yr = sc and sc:FindFirstChild("YourRanking")
        if yr then
            local frVal = yr:FindFirstChild("FurthestRoom") and yr.FurthestRoom:FindFirstChild("V") and yr.FurthestRoom.V:FindFirstChild("V")
            if frVal and frVal:IsA("TextLabel") then
                local rNum = tonumber(tostring(frVal.Text):match("%d+"))
                if rNum and rNum > 0 then info.gui_room = rNum end
            end
            local rtVal = yr:FindFirstChild("RankTitle") and yr.RankTitle:FindFirstChild("V") and yr.RankTitle.V:FindFirstChild("V")
            if rtVal and rtVal:IsA("TextLabel") then
                local t = tostring(rtVal.Text or ""):gsub("<[^>]+>", ""):match("^%s*(.-)%s*$")
                if t ~= "" and t ~= "???" then info.rank_title = t end
            end
            local rkVal = yr:FindFirstChild("Ranking") and yr.Ranking:FindFirstChild("V") and yr.Ranking.V:FindFirstChild("V")
            if rkVal and rkVal:IsA("TextLabel") then
                local p = tostring(rkVal.Text or ""):gsub("<[^>]+>", ""):match("^%s*(.-)%s*$")
                if p ~= "" and p ~= "???" then info.rank_pct = p end
            end
        end

        local evUi = pg:FindFirstChild("EventTowerUI")
        if evUi then
            local evLs = evUi:FindFirstChild("LevelSelect")
            local evTop = evLs and evLs:FindFirstChild("Top")
            local evTitle = evTop and evTop:FindFirstChild("Title")
            if evTitle and evTitle:IsA("TextLabel") then
                local en = tostring(evTitle.Text or ""):gsub("<[^>]+>", ""):gsub("%s+", " "):match("^%s*(.-)%s*$")
                if en ~= "" and en ~= "???" then info.event_name = en end
            end

            local evInfo = evLs and evLs:FindFirstChild("InfoFrame")
            local evStats = evInfo and evInfo:FindFirstChild("Stats")
            local evWorld = evStats and evStats:FindFirstChild("World")
            if evWorld and evWorld:IsA("TextLabel") then
                local ew = tostring(evWorld.Text or ""):gsub("<[^>]+>", ""):match("^%s*(.-)%s*$")
                if ew ~= "" and ew ~= "???" then info.event_world = ew end
            end

            local evLb = evUi:FindFirstChild("InfiniteLeaderboard")
            local evRk = evLb and evLb:FindFirstChild("Ranking")
            local evWrap = evRk and evRk:FindFirstChild("Wrapper")
            local evFrame = evWrap and evWrap:FindFirstChild("Frame")
            if evFrame then
                local efr = evFrame:FindFirstChild("FurthestRoom") and evFrame.FurthestRoom:FindFirstChild("V")
                if efr and efr:IsA("TextLabel") then
                    local ecNum = tonumber(tostring(efr.Text):match("%d+"))
                    if ecNum and ecNum >= 0 then info.event_cleared = ecNum end
                end
                local erp = evFrame:FindFirstChild("Ranking") and evFrame.Ranking:FindFirstChild("V")
                if erp and erp:IsA("TextLabel") then
                    local p = tostring(erp.Text or ""):gsub("<[^>]+>", ""):match("^%s*(.-)%s*$")
                    if p ~= "" and p ~= "???" then info.event_rank_pct = p end
                end
                local ert = evFrame:FindFirstChild("RankTitle") and evFrame.RankTitle:FindFirstChild("V")
                if ert and ert:IsA("TextLabel") then
                    local r = tostring(ert.Text or ""):gsub("<[^>]+>", ""):match("^%s*(.-)%s*$")
                    if r ~= "" and r ~= "???" then info.event_rank = r end
                end
            end
        end
    end)
    return info
end
local lastGcScanAt = 0
local lastGcComplete = false
local cachedUnitDefs = nil
local cachedItemDefs = nil
local cachedTraitDefs = nil

local function prettifyItemId(idStr)
    local clean = tostring(idStr or ""):gsub("^portal_item__", ""):gsub("^portal_", ""):gsub("_", " ")
    clean = clean:gsub("(%a)([%w']*)", function(a, b) return a:upper() .. b end)
    if clean:lower():find("skypiea") then return "Sky Portal" end
    if clean:lower():find("summer2 secret") then return "Explosion Mage's Portal" end
    if not clean:lower():find("portal") then clean = clean .. " Portal" end
    return clean
end

local function prettifyId(idStr)
    local clean = tostring(idStr or ""):gsub("_", " ")
    clean = clean:gsub("(%a)([%w']*)", function(a, b) return a:upper() .. b end)
    return clean
end

local function getUnitDefs()
    if cachedUnitDefs ~= nil then return cachedUnitDefs end
    cachedUnitDefs = {}
    pcall(function()
        local data = ReplicatedStorage:FindFirstChild("src") and ReplicatedStorage.src:FindFirstChild("Data")
        local uMod = data and data:FindFirstChild("Units")
        if uMod then
            local ok, res = pcall(require, uMod)
            if ok and type(res) == "table" then
                cachedUnitDefs = res
            end
        end
    end)
    return cachedUnitDefs
end

local function getItemDefs()
    if cachedItemDefs ~= nil then return cachedItemDefs end
    cachedItemDefs = {}
    pcall(function()
        local data = ReplicatedStorage:FindFirstChild("src") and ReplicatedStorage.src:FindFirstChild("Data")
        local iMod = data and data:FindFirstChild("Items")
        if iMod then
            local ok, res = pcall(require, iMod)
            if ok and type(res) == "table" then
                cachedItemDefs = res
            end
        end
    end)
    return cachedItemDefs
end

local function getTraitDefs()
    if cachedTraitDefs ~= nil then return cachedTraitDefs end
    cachedTraitDefs = {}
    pcall(function()
        local data = ReplicatedStorage:FindFirstChild("src") and ReplicatedStorage.src:FindFirstChild("Data")
        local trMod = data and data:FindFirstChild("Traits")
        if trMod then
            local ok, res = pcall(require, trMod)
            if ok and type(res) == "table" and type(res.info) == "table" then
                cachedTraitDefs = res.info
            end
        end
    end)
    return cachedTraitDefs
end

local function normalizeTraitKey(rawTrait)
    local low = tostring(rawTrait or ""):lower()
    if low == "ethereal" then return "celestial"
    elseif low == "neuroplasticity" then return "adept"
    elseif low == "superior" then return "vigorous"
    elseif low == "nimble" then return "swift"
    elseif low == "marksman" then return "range"
    end
    return low
end

local function classifyItemCategory(itemId, dispName, itemDef, rawEntry)
    local idLow = tostring(itemId or ""):lower()
    local nameLow = tostring(dispName or ""):lower()
    local grp = type(itemDef) == "table" and tostring(itemDef.item_group or ""):lower() or ""

    if grp == "portals" or idLow:find("portal") or nameLow:find("portal") then
        return "portal"
    end
    if type(rawEntry) == "table" then
        local udata = rawget(rawEntry, "_unique_item_data")
        if type(udata) == "table" and rawget(udata, "_unique_relic_data") then
            return "relic"
        end
    end
    if grp == "relics" or idLow:find("^artifact_") or idLow:find("relic") or nameLow:find("relic") then
        return "relic"
    end
    if grp == "skins" or idLow:find("_skin$") then
        return "skin"
    end
    if grp == "keys" or idLow:find("^key_") or idLow:find("^lucy_key") or idLow == "dungeon_key" or idLow:find("^raid_ticket") or nameLow:find("key ") then
        return "key"
    end
    if grp == "xp food" or idLow:find("_xp") or idLow == "senzu_bean" or idLow == "hxh_fish" or idLow == "aot_fluid" or idLow == "soul_candy" or idLow == "dressrosa_grapes" or idLow == "cupcake" then
        return "xp_food"
    end
    if grp == "stars" or idLow:find("^starfruit") or idLow:find("^capsule_") or idLow:find("^star_remnant") or nameLow:find("star fruit") or nameLow:find("star remnant") then
        return "star"
    end
    if grp == "boosts" or idLow == "luckpotion" or idLow == "shinypotion" or nameLow:find("potion") then
        return "boost"
    end
    if grp == "gifts" or idLow:find("^gift__") or idLow == "christmas_present" or idLow:find("^easter_egg") then
        return "gift"
    end
    if grp == "materials" or idLow:find("^reroll_") or idLow == "summon_ticket" or idLow == "swordsmith_dawn_coin" then
        return "material"
    end
    if grp == "defenses" or grp == "charms" or grp == "emotes" or grp == "maps" then
        return "other"
    end
    return "material"
end

local function inferRarityFallback(rawName, idName)
    local low = (tostring(rawName or "") .. " " .. tostring(idName or "")):lower()
    if low:find("secret") or low:find("explosion") or low:find("demon") or low:find("perfect") or low:find("conqueror") or low:find("compass") or low:find("divine") then
        return "Secret"
    elseif low:find("portal") or low:find("cube") or low:find("remnant") or low:find("reroll") or low:find("key") or low:find("orb") or low:find("ball") or low:find("staff") or low:find("wings") or low:find("dawn") or low:find("charm") then
        return "Mythic"
    else
        return "Legendary"
    end
end

local function scanGcFullInventoryIfDue(force)
    if type(getgc) ~= "function" then return nil end
    if not force and (os.time() - lastGcScanAt) < 35 and (next(cachedGcPortals) ~= nil or next(cachedGcItems) ~= nil or #cachedGcUnits > 0) then
        return { portals = cachedGcPortals, items = cachedGcItems, units = cachedGcUnits, complete = lastGcComplete }
    end
    lastGcScanAt = os.time()

    local unitDefs = getUnitDefs()
    local itemDefs = getItemDefs()
    local traitDefs = getTraitDefs()

    local ok, result = pcall(function()
        local nameById = {}
        local profileTable = nil
        local bestUniqueContainer = nil
        local bestUniqueCount = 0
        local bestNormalContainer = nil
        local bestUnitContainer = nil
        local bestUnitCount = 0

        local bpTierArrays = {}
        local bpNamedContainers = {}

        for _, t in ipairs(getgc(true)) do
            if type(t) == "table" then
                if rawget(t, "Eclipse Portal") or rawget(t, "Sky Portal") or rawget(t, "Lotus Scepter") then
                    for dispName, itemId in pairs(t) do
                        if type(dispName) == "string" and type(itemId) == "string" then
                            nameById[itemId] = dispName
                        end
                    end
                elseif type(rawget(t, "inventory")) == "table" and type(rawget(t, "collection")) == "table" and (rawget(t, "gold_amount") ~= nil or rawget(t, "gem_amount") ~= nil) then
                    profileTable = t
                elseif rawget(t, "fairy_tail_shard") and rawget(t, "arrancar_mask") and type(rawget(t, "fairy_tail_shard")) == "number" then
                    bestNormalContainer = t
                elseif type(rawget(t, "mana_october")) == "table" or type(rawget(t, "trion_november")) == "table" or type(rawget(t, "flower_june")) == "table" then
                    table.insert(bpNamedContainers, t)
                else
                    local v1 = rawget(t, 1)
                    if type(v1) == "table" and rawget(v1, "xp_required") ~= nil and rawget(v1, "normal_reward") ~= nil then
                        table.insert(bpTierArrays, t)
                    end
                    local k, firstVal = next(t)
                    if k ~= nil and type(firstVal) == "table" then
                        if rawget(firstVal, "item_id") and (rawget(firstVal, "uuid") or rawget(firstVal, "_unique_item_data")) then
                            local cnt = 0
                            for _ in pairs(t) do cnt = cnt + 1 end
                            if cnt > bestUniqueCount then
                                bestUniqueCount = cnt
                                bestUniqueContainer = t
                            end
                        elseif rawget(firstVal, "unit_id") and rawget(firstVal, "uuid") then
                            local cnt = 0
                            for _ in pairs(t) do cnt = cnt + 1 end
                            if cnt > bestUnitCount then
                                bestUnitCount = cnt
                                bestUnitContainer = t
                            end
                        end
                    end
                end
            end
        end

        local invTable = profileTable and rawget(profileTable, "inventory") or nil
        local uniqueContainer = (type(invTable) == "table" and type(rawget(invTable, "unique_items")) == "table") and rawget(invTable, "unique_items") or bestUniqueContainer
        local normalContainer = (type(invTable) == "table" and type(rawget(invTable, "normal_items")) == "table") and rawget(invTable, "normal_items") or bestNormalContainer

        local portalsMap = {}
        local itemsMap = {}
        local seenUuid = {}

        if type(uniqueContainer) == "table" then
            for key, entry in pairs(uniqueContainer) do
                if type(entry) == "table" then
                    local itemId = rawget(entry, "item_id")
                    local uid = tostring(rawget(entry, "uuid") or key)
                    if type(itemId) == "string" and not seenUuid[uid] then
                        seenUuid[uid] = true
                        local def = itemDefs[itemId]
                        local dispName = (type(def) == "table" and def.name) or nameById[itemId] or prettifyId(itemId)
                        local udata = rawget(entry, "_unique_item_data")
                        if type(udata) == "string" then
                            local decOk, dec = pcall(HttpService.JSONDecode, HttpService, udata)
                            udata = decOk and dec or nil
                        end
                        local cat = classifyItemCategory(itemId, dispName, def, entry)

                        if cat == "portal" then
                            if dispName == prettifyId(itemId) then
                                dispName = prettifyItemId(itemId)
                            end
                            local pdata = type(udata) == "table" and rawget(udata, "_unique_portal_data") or nil
                            local depth = type(pdata) == "table" and tonumber(rawget(pdata, "portal_depth")) or nil
                            local tierStr = depth and ("T" .. tostring(depth)) or "T0"
                            local hearts = type(pdata) == "table" and tonumber(rawget(pdata, "_host_star_remnants")) or nil
                            local multVal = type(pdata) == "table" and (tonumber(rawget(pdata, "_portal_reward_scale")) or tonumber(rawget(pdata, "difficulty_scale"))) or nil
                            local multStr = (multVal and multVal > 1) and ("x" .. string.format("%.1f", multVal)) or nil
                            local ctl = type(pdata) == "table" and rawget(pdata, "_ctl") or nil
                            local lvMods = type(ctl) == "table" and rawget(ctl, "_levelmodifiers") or nil
                            local modCount = type(lvMods) == "table" and #lvMods or 0
                            local modStr = modCount > 0 and (tostring(modCount) .. " ม็อด") or nil

                            local low = (dispName .. " " .. itemId):lower()
                            local rarity = (type(def) == "table" and def.rarity) or ((low:find("secret") or low:find("explosion") or low:find("demon")) and "Secret" or "Mythic")

                            local gkey = dispName .. "_" .. tierStr
                            if not portalsMap[gkey] then
                                portalsMap[gkey] = {
                                    name = dispName,
                                    amount = 0,
                                    rarity = rarity,
                                    category = "portal",
                                    tier = tierStr,
                                    hearts = hearts,
                                    multiplier = multStr,
                                    mods = modStr,
                                }
                            end
                            portalsMap[gkey].amount = portalsMap[gkey].amount + 1
                        else
                            local rarity = (type(def) == "table" and def.rarity) or inferRarityFallback(dispName, itemId)
                            local gkey = cat .. "::" .. dispName .. "::" .. rarity
                            if not itemsMap[gkey] then
                                itemsMap[gkey] = {
                                    name = dispName,
                                    amount = 0,
                                    rarity = rarity,
                                    category = cat,
                                }
                            end
                            itemsMap[gkey].amount = itemsMap[gkey].amount + 1
                        end
                    end
                end
            end
        end

        if type(normalContainer) == "table" then
            for itemId, rawQty in pairs(normalContainer) do
                local qty = tonumber(rawQty)
                if type(itemId) == "string" and qty and qty > 0 and not itemId:find("__MOCK") then
                    local def = itemDefs[itemId]
                    local dispName = (type(def) == "table" and def.name) or nameById[itemId] or prettifyId(itemId)
                    local rarity = (type(def) == "table" and def.rarity) or inferRarityFallback(dispName, itemId)
                    local cat = classifyItemCategory(itemId, dispName, def, nil)
                    if cat ~= "portal" then
                        local gkey = cat .. "::" .. dispName .. "::" .. rarity
                        if not itemsMap[gkey] then
                            itemsMap[gkey] = {
                                name = dispName,
                                amount = 0,
                                rarity = rarity,
                                category = cat,
                            }
                        end
                        itemsMap[gkey].amount = itemsMap[gkey].amount + qty
                    end
                end
            end
        end

        local equippedSet = {}
        local col = profileTable and rawget(profileTable, "collection") or nil
        if type(col) == "table" then
            local eq = rawget(col, "equipped_units")
            if type(eq) == "table" then
                for ek, ev in pairs(eq) do
                    if type(ev) == "string" then
                        equippedSet[ev] = true
                    elseif type(ek) == "string" and ev then
                        equippedSet[ek] = true
                    end
                end
            end
        end

        local unitsGrouped = {}
        if type(bestUnitContainer) == "table" then
            local seenUnitUuid = {}
            for key, entry in pairs(bestUnitContainer) do
                if type(entry) == "table" then
                    local unitId = rawget(entry, "unit_id")
                    local uid = tostring(rawget(entry, "uuid") or key)
                    if type(unitId) == "string" and not seenUnitUuid[uid] then
                        seenUnitUuid[uid] = true
                        local def = unitDefs[unitId]
                        local uName = (type(def) == "table" and def.name) or prettifyId(unitId)
                        local uRarity = (type(def) == "table" and def.rarity) or "Mythic"
                        local isShiny = (rawget(entry, "shiny") == true)
                        local xpVal = tonumber(rawget(entry, "xp")) or 0
                        local lvlVal = tonumber(rawget(entry, "level"))
                        if not lvlVal and xpVal <= 0 then
                            lvlVal = 1
                        end
                        local isEq = equippedSet[uid] == true

                        local rawTrait = rawget(entry, "trait")
                        local traitTier = nil
                        local traitsTbl = rawget(entry, "traits")
                        if not rawTrait and type(traitsTbl) == "table" then
                            local t1 = rawget(traitsTbl, "1") or rawget(traitsTbl, 1)
                            if type(t1) ~= "table" then
                                local _, firstTr = next(traitsTbl)
                                t1 = firstTr
                            end
                            if type(t1) == "table" then
                                rawTrait = rawget(t1, "trait")
                                traitTier = tonumber(rawget(t1, "tier")) or rawget(t1, "tier")
                            end
                        end

                        local traitNorm = rawTrait and normalizeTraitKey(rawTrait) or nil
                        local tInfo = rawTrait and traitDefs[tostring(rawTrait)] or nil
                        local traitDisplay = (type(tInfo) == "table" and tInfo.name) or (traitNorm and prettifyId(traitNorm)) or nil

                        local gkey = table.concat({
                            uName,
                            isShiny and "S" or "N",
                            traitNorm or "",
                            tostring(traitTier or ""),
                            isEq and "E" or "U",
                        }, "|")
                        local grp = unitsGrouped[gkey]
                        if not grp then
                            grp = {
                                id = unitId,
                                name = uName,
                                rarity = uRarity,
                                shiny = isShiny,
                                trait = traitNorm,
                                trait_name = traitDisplay,
                                trait_tier = traitTier and tostring(traitTier) or nil,
                                equipped = isEq,
                                level = lvlVal,
                                max_xp = math.floor(xpVal),
                                amount = 0,
                            }
                            unitsGrouped[gkey] = grp
                        end
                        grp.amount = grp.amount + 1
                        if math.floor(xpVal) > (grp.max_xp or 0) then
                            grp.max_xp = math.floor(xpVal)
                        end
                        if lvlVal and (not grp.level or lvlVal > grp.level) then
                            grp.level = lvlVal
                        end
                    end
                end
            end
        end

        local unitsList = {}
        for _, u in pairs(unitsGrouped) do
            table.insert(unitsList, u)
        end
        local rarityRank = { Secret = 1, Exclusive = 2, Mythic = 3, Legendary = 4, Epic = 5, Rare = 6, Common = 7 }
        table.sort(unitsList, function(a, b)
            if a.equipped ~= b.equipped then return a.equipped end
            local ra = rarityRank[a.rarity] or 9
            local rb = rarityRank[b.rarity] or 9
            if ra ~= rb then return ra < rb end
            if a.shiny ~= b.shiny then return a.shiny end
            if (a.max_xp or 0) ~= (b.max_xp or 0) then return (a.max_xp or 0) > (b.max_xp or 0) end
            return a.name < b.name
        end)

        local profileCur = {}
        local starRemSummary = nil
        local battlePassSummary = nil
        local totalTraitRerollsVal = nil

        if type(normalContainer) == "table" then
            local sLim = tonumber(rawget(normalContainer, "star_remnant_limited")) or 0
            local sReg = tonumber(rawget(normalContainer, "star_remnant")) or 0
            starRemSummary = { total = sLim + sReg, limited = sLim, regular = sReg }
        end

        if type(profileTable) == "table" then
            local pg = tonumber(rawget(profileTable, "gem_amount"))
            local pgo = tonumber(rawget(profileTable, "gold_amount"))
            if pg then profileCur["Gems"] = pg end
            if pgo then profileCur["Gold"] = pgo end
            totalTraitRerollsVal = tonumber(rawget(profileTable, "total_trait_rerolls"))
            local resTbl = rawget(profileTable, "resources")
            if type(resTbl) == "table" then
                for rk, rv in pairs(resTbl) do
                    local num = tonumber(rv)
                    if type(rk) == "string" and num then
                        if rk == "SummerPearls" then profileCur["Summer Pearls"] = num
                        elseif rk == "AprilCoins" then profileCur["Dawn Coins"] = num
                        else profileCur[rk] = num end
                    end
                end
            end

            -- Parse Battle Pass progress & seasons
            local bpData = rawget(profileTable, "battlepass_data")
            if type(bpData) == "table" then
                local seasonsList = {}
                local bestSeason = nil

                local function countClaimed(tbl)
                    if type(tbl) ~= "table" then return 0, {} end
                    local c = 0
                    local map = {}
                    for ck, cv in pairs(tbl) do
                        if cv then
                            c = c + 1
                            map[tostring(ck)] = true
                        end
                    end
                    return c, map
                end

                for sid, sdata in pairs(bpData) do
                    if type(sid) == "string" and type(sdata) == "table" then
                        local xpNum = tonumber(rawget(sdata, "xp")) or 0
                        local hasPrem = rawget(sdata, "has_premium") == true
                        local ct = rawget(sdata, "claimed_tiers")
                        local normCnt, normMap = countClaimed(type(ct) == "table" and rawget(ct, "normal") or nil)
                        local premCnt, premMap = countClaimed(type(ct) == "table" and rawget(ct, "premium") or nil)
                        local entry = {
                            id = sid,
                            name = prettifyId(sid),
                            xp = math.floor(xpNum),
                            has_premium = hasPrem,
                            normal_claimed = normCnt,
                            premium_claimed = premCnt,
                            normMap = normMap,
                            premMap = premMap,
                        }
                        if xpNum > 0 or hasPrem or normCnt > 0 then
                            table.insert(seasonsList, {
                                id = entry.id,
                                name = entry.name,
                                xp = entry.xp,
                                has_premium = entry.has_premium,
                                normal_claimed = entry.normal_claimed,
                                premium_claimed = entry.premium_claimed,
                            })
                        end
                        if not bestSeason or entry.xp > bestSeason.xp or (entry.xp == bestSeason.xp and entry.normal_claimed > bestSeason.normal_claimed) then
                            bestSeason = entry
                        end
                    end
                end

                table.sort(seasonsList, function(a, b) return a.xp > b.xp end)

                if bestSeason then
                    -- Try matching tier definition table in GC for exact level, xp thresholds & reward preview
                    local tierArr = nil
                    for _, nc in ipairs(bpNamedContainers) do
                        local sd = rawget(nc, bestSeason.id)
                        if type(sd) == "table" then
                            if type(rawget(sd, "tiers")) == "table" then tierArr = rawget(sd, "tiers")
                            elseif type(rawget(sd, 1)) == "table" and rawget(rawget(sd, 1), "xp_required") ~= nil then tierArr = sd end
                            if tierArr then break end
                        end
                    end
                    if not tierArr and #bpTierArrays == 1 then
                        tierArr = bpTierArrays[1]
                    end

                    local function describeReward(rw)
                        if type(rw) ~= "table" then return nil end
                        if tonumber(rw.gems) then return "Gems x" .. tostring(rw.gems) end
                        if tonumber(rw.gold) then return "Gold x" .. tostring(rw.gold) end
                        local iid = rawget(rw, "item_id")
                        local uid = rawget(rw, "unit_id")
                        local amt = tonumber(rawget(rw, "amount")) or 1
                        if type(iid) == "string" then
                            local d = itemDefs[iid]
                            local nm = (type(d) == "table" and d.name) or nameById[iid] or prettifyId(iid)
                            return amt > 1 and (nm .. " x" .. tostring(amt)) or nm
                        elseif type(uid) == "string" then
                            local d = unitDefs[uid]
                            local nm = (type(d) == "table" and d.name) or prettifyId(uid)
                            return amt > 1 and (nm .. " x" .. tostring(amt)) or nm
                        end
                        return nil
                    end

                    local maxLvl = 60
                    local unlockedLvl = math.max(bestSeason.normal_claimed, bestSeason.premium_claimed)
                    local parsedTiers = {}
                    if type(tierArr) == "table" and #tierArr > 0 then
                        maxLvl = #tierArr
                        local calcUnlocked = 0
                        for idx, tObj in ipairs(tierArr) do
                            if type(tObj) == "table" then
                                local xReq = tonumber(rawget(tObj, "xp_required")) or 0
                                if bestSeason.xp >= xReq then
                                    calcUnlocked = idx
                                end
                                table.insert(parsedTiers, {
                                    tier = idx,
                                    xp_req = xReq,
                                    normal = describeReward(rawget(tObj, "normal_reward")),
                                    premium = describeReward(rawget(tObj, "premium_reward")),
                                    n_claimed = bestSeason.normMap[tostring(idx)] == true,
                                    p_claimed = bestSeason.premMap[tostring(idx)] == true,
                                })
                            end
                        end
                        if calcUnlocked > unlockedLvl then
                            unlockedLvl = calcUnlocked
                        end
                    end

                    battlePassSummary = {
                        season_id = bestSeason.id,
                        season_name = bestSeason.name,
                        xp = bestSeason.xp,
                        has_premium = bestSeason.has_premium,
                        level = unlockedLvl,
                        max_level = maxLvl,
                        normal_claimed = bestSeason.normal_claimed,
                        premium_claimed = bestSeason.premium_claimed,
                        tiers = parsedTiers,
                        seasons = seasonsList,
                    }
                end
            end
        end

        local towerSummary = nil
        local guiTower = readTowerGuiInfo()
        local infRoom = nil
        local eventFloors = nil
        local dungeonDepth = nil

        if profileTable then
            local ld = rawget(profileTable, "level_data")
            local it = type(ld) == "table" and rawget(ld, "infinite_tower") or nil
            if type(it) == "table" then
                local fr = tonumber(rawget(it, "floor_reached"))
                if fr and fr > 0 then infRoom = fr end
            end

            local etf = rawget(profileTable, "_event_tower_floors")
            if type(etf) == "table" then
                for k, v in pairs(etf) do
                    local fv = tonumber(v)
                    if type(k) == "string" and fv and fv > 0 then
                        eventFloors = eventFloors or {}
                        eventFloors[k] = fv
                    end
                end
            end

            local dd = rawget(profileTable, "dungeon_data")
            if type(dd) == "table" and rawget(dd, "_started") then
                local dn = tonumber(rawget(dd, "depth")) or tonumber(rawget(dd, "floor")) or tonumber(rawget(dd, "room"))
                if dn and dn > 0 then dungeonDepth = dn end
            end
        end

        local finalRoom = infRoom or guiTower.gui_room
        local evCleared = guiTower.event_cleared
        if not evCleared and type(eventFloors) == "table" then
            for _, fv in pairs(eventFloors) do
                if type(fv) == "number" and (not evCleared or fv > evCleared) then
                    evCleared = fv
                end
            end
        end
        if finalRoom or eventFloors or evCleared or guiTower.event_name or dungeonDepth then
            towerSummary = {
                infinite_room = finalRoom,
                season = guiTower.season,
                rank_title = guiTower.rank_title,
                rank_pct = guiTower.rank_pct,
                event_floors = eventFloors,
                event_name = guiTower.event_name,
                event_world = guiTower.event_world,
                event_cleared = evCleared,
                event_rank_pct = guiTower.event_rank_pct,
                event_rank = guiTower.event_rank,
                dungeon_depth = dungeonDepth,
            }
        end

        return {
            portals = portalsMap,
            items = itemsMap,
            units = unitsList,
            traitRerolls = profileTable and tonumber(rawget(profileTable, "trait_reroll_tokens")) or nil,
            totalTraitRerolls = totalTraitRerollsVal,
            starRemnants = starRemSummary,
            battlePass = battlePassSummary,
            towerData = towerSummary,
            profileCur = profileCur,
            complete = (type(normalContainer) == "table" and next(itemsMap) ~= nil),
        }
    end)

    if ok and result then
        if next(result.portals) ~= nil then cachedGcPortals = result.portals end
        if next(result.items) ~= nil then cachedGcItems = result.items end
        if #result.units > 0 then cachedGcUnits = result.units end
        if result.traitRerolls ~= nil then cachedTraitRerolls = result.traitRerolls end
        if result.totalTraitRerolls ~= nil then cachedTotalTraitRerolls = result.totalTraitRerolls end
        if result.starRemnants ~= nil then cachedStarRemnants = result.starRemnants end
        if result.battlePass ~= nil then cachedBattlePass = result.battlePass end
        if type(result.towerData) == "table" then
            local mergedTower = {}
            if type(cachedTowerData) == "table" then
                for k, v in pairs(cachedTowerData) do mergedTower[k] = v end
            end
            for k, v in pairs(result.towerData) do
                if v ~= nil then mergedTower[k] = v end
            end
            cachedTowerData = mergedTower
        end
        if type(result.profileCur) == "table" and next(result.profileCur) ~= nil then
            cachedProfileCur = result.profileCur
        end
        lastGcComplete = result.complete == true
        return {
            portals = cachedGcPortals,
            items = cachedGcItems,
            units = cachedGcUnits,
            traitRerolls = cachedTraitRerolls,
            totalTraitRerolls = cachedTotalTraitRerolls,
            starRemnants = cachedStarRemnants,
            battlePass = cachedBattlePass,
            towerData = cachedTowerData,
            profileCur = cachedProfileCur,
            complete = lastGcComplete,
        }
    end
    return nil
end

-- Scan inventory items from PlayerGui.items.grid.List.Outer.ItemFrames (preserves previously viewed tabs like Portals vs Items)
local cachedCategoryItems = { portal = {}, item = {} }

local function readUsefulItems(allowGcScan)
    local seenPortal = false
    local seenItem = false
    local counts = { portal = {}, item = {} }
    local itemDefs = getItemDefs()

    local function addItem(rawName, amt, idName, extra)
        if not rawName or type(rawName) ~= "string" then return end
        local trimmed = rawName:match("^%s*(.-)%s*$")
        if not trimmed or #trimmed == 0 then return end
        local low = trimmed:lower()
        if low == "portals" or low == "item" or low == "items" or low == "item name" then
            return
        end
        local def = idName and itemDefs[idName] or nil
        local cat = classifyItemCategory(idName, trimmed, def, nil)
        if cat == "portal" then seenPortal = true else seenItem = true end
        local key = trimmed .. (extra and extra.tier and ("_" .. extra.tier) or "")
        if not counts[cat == "portal" and "portal" or "item"][key] then
            counts[cat == "portal" and "portal" or "item"][key] = {
                name = trimmed,
                amount = 0,
                rarity = (type(def) == "table" and def.rarity) or inferRarityFallback(trimmed, idName),
                category = cat,
                tier = extra and extra.tier or nil,
                hearts = extra and extra.hearts or nil,
                multiplier = extra and extra.multiplier or nil,
                mods = extra and extra.mods or nil,
            }
        end
        local bucket = counts[cat == "portal" and "portal" or "item"][key]
        bucket.amount = bucket.amount + (tonumber(amt) or 1)
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
                        local extra = {}
                        -- Extract portal tier (T1..T10) & optional metadata if present on frame
                        local tierMatch = nameLbl.Text:match("[Tt](%d+)") or frame.Name:match("[Tt](%d+)")
                        local enhLbl = mainFrame and mainFrame:FindFirstChild("EnhanceLevel")
                        if not tierMatch and enhLbl and enhLbl:IsA("TextLabel") then
                            tierMatch = enhLbl.Text:match("[Tt](%d+)")
                        end
                        local tierLbl = frame:FindFirstChild("Tier", true)
                        if not tierMatch and tierLbl and tierLbl:IsA("TextLabel") then
                            tierMatch = tierLbl.Text:match("(%d+)")
                        end
                        if tierMatch then
                            extra.tier = "T" .. tierMatch
                        end
                        local livesLbl = frame:FindFirstChild("Lives", true) or frame:FindFirstChild("Hearts", true)
                        if livesLbl and livesLbl:IsA("TextLabel") then
                            extra.hearts = tonumber((livesLbl.Text:gsub("[^%d]", "")))
                        end
                        local multLbl = frame:FindFirstChild("Multiplier", true) or frame:FindFirstChild("RewardMultiplier", true)
                        if multLbl and multLbl:IsA("TextLabel") and #multLbl.Text > 0 then
                            extra.multiplier = multLbl.Text
                        end
                        addItem(nameLbl.Text, q, frame.Name, extra)
                    end
                end
            end
        end
    end)

    local gcRes = nil
    if allowGcScan then
        gcRes = scanGcFullInventoryIfDue(false)
    elseif next(cachedGcItems) ~= nil or next(cachedGcPortals) ~= nil then
        gcRes = { portals = cachedGcPortals, items = cachedGcItems, units = cachedGcUnits, complete = lastGcComplete }
    end

    if gcRes and next(gcRes.portals) ~= nil then
        cachedCategoryItems.portal = gcRes.portals
        seenPortal = true
    elseif seenPortal and next(counts.portal) ~= nil then
        cachedCategoryItems.portal = counts.portal
    end

    local isComplete = false
    if gcRes and gcRes.complete and next(gcRes.items) ~= nil then
        cachedCategoryItems.item = gcRes.items
        seenItem = true
        isComplete = true
    elseif seenItem then
        cachedCategoryItems.item = counts.item
    end

    local list = {}
    for _, v in pairs(cachedCategoryItems.portal) do
        table.insert(list, v)
    end
    for _, v in pairs(cachedCategoryItems.item) do
        table.insert(list, v)
    end
    return list, (seenPortal or seenItem), (gcRes and gcRes.units or cachedGcUnits), isComplete
end

-- Read equipped 6-unit team from PlayerGui.spawn_units.Lives.Frame.Units (slots 1..6)
local function readEquippedTeam()
    local team = {}
    pcall(function()
        local traitByImage = {}
        pcall(function()
            local rs = game:GetService("ReplicatedStorage")
            local pkg = rs:FindFirstChild("packages")
            local assets = pkg and pkg:FindFirstChild("assets")
            local gui = assets and assets:FindFirstChild("gui")
            local traitIcons = gui and gui:FindFirstChild("TraitIcons")
            if traitIcons then
                for _, child in ipairs(traitIcons:GetChildren()) do
                    if child:IsA("ImageLabel") and #child.Image > 0 then
                        traitByImage[child.Image] = child.Name:lower()
                    end
                end
            end
        end)

        local pg = LocalPlayer:FindFirstChild("PlayerGui")
        local su = pg and pg:FindFirstChild("spawn_units")
        local lives = su and su:FindFirstChild("Lives")
        local frame = lives and lives:FindFirstChild("Frame")
        local units = frame and frame:FindFirstChild("Units")
        if not units then return end

        for slot = 1, 6 do
            local slotObj = units:FindFirstChild(tostring(slot))
            if slotObj and slotObj:IsA("GuiObject") and slotObj.Visible then
                local nameLbl = slotObj:FindFirstChild("name", true)
                local unitName = (nameLbl and nameLbl:IsA("TextLabel") and nameLbl.Text) or ""
                if #unitName > 0 and unitName ~= "Unit" and unitName ~= "Empty" then
                    local lvl = slotObj:GetAttribute("Level")
                    if not lvl then
                        local lvlLbl = slotObj:FindFirstChild("Level", true) or slotObj:FindFirstChild("Lvl", true)
                        if lvlLbl and lvlLbl:IsA("TextLabel") then
                            lvl = tonumber((lvlLbl.Text:gsub("[^%d]", "")))
                        end
                    end
                    local costLbl = slotObj:FindFirstChild("text", true) or slotObj:FindFirstChild("cost", true)
                    local costVal = (costLbl and costLbl:IsA("TextLabel") and costLbl.Text ~= "9999") and tonumber((costLbl.Text:gsub("[^%d]", ""))) or nil
                    local traitName = slotObj:GetAttribute("Trait")
                    if not traitName then
                        for _, desc in ipairs(slotObj:GetDescendants()) do
                            if desc:IsA("ImageLabel") and desc.Visible and traitByImage[desc.Image] then
                                traitName = traitByImage[desc.Image]
                                break
                            end
                        end
                    end
                    table.insert(team, {
                        slot = slot,
                        name = unitName,
                        level = lvl,
                        cost = costVal,
                        trait = traitName and tostring(traitName):lower() or nil,
                    })
                end
            end
        end
    end)
    return team
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
        if waveVal and waveVal:IsA("ValueBase") and tonumber(waveVal.Value) and tonumber(waveVal.Value) > 0 then
            waveStr = "Wave " .. tostring(waveVal.Value)
        end
        local mapAttr = Workspace:GetAttribute("MapName") or Workspace:GetAttribute("LevelName")
        if mapAttr then mapName = tostring(mapAttr) end
        local modeAttr = Workspace:GetAttribute("GameMode") or Workspace:GetAttribute("Mode")
        if modeAttr then mode = tostring(modeAttr) end

        -- Read from PlayerGui.Waves.HealthBar when in-game
        local pg = LocalPlayer:FindFirstChild("PlayerGui")
        local waves = pg and pg:FindFirstChild("Waves")
        local hb = waves and waves:FindFirstChild("HealthBar")
        if hb then
            local wn = hb:FindFirstChild("WaveNumber")
            if waveStr == "-" and wn and wn:IsA("TextLabel") then
                local wNum = tonumber((wn.Text:gsub("[^%d]", "")))
                if wNum and wNum > 0 then
                    waveStr = "Wave " .. tostring(wNum)
                end
            end
        end
        local lt = hb and hb:FindFirstChild("LevelTitle")
        if lt then
            local mLbl = lt:FindFirstChild("Map")
            local lLbl = lt:FindFirstChild("Level")
            if lLbl and lLbl:IsA("TextLabel") and #lLbl.Text > 0 then
                local lvlTxt = lLbl.Text
                local lowLvl = lvlTxt:lower()
                local roomNum = tonumber(lowLvl:match("room%s*(%d+)"))
                local floorNum = tonumber(lowLvl:match("floor%s*(%d+)"))
                if lowLvl:find("dungeon") or lowLvl:find("depth") then
                    mode = "Dungeon"
                elseif lowLvl:find("infinity mansion") or lowLvl:find("infinite tower") or lowLvl:find("infinity castle") or (roomNum and not lowLvl:find("dungeon")) then
                    mode = "Infinity Tower"
                    if roomNum and roomNum > 0 then cachedActiveTowerRoom = roomNum end
                elseif lowLvl:find("misty") or lowLvl:find("event tower") or (floorNum and floorNum > 0) then
                    mode = "Event Tower"
                    if floorNum and floorNum > 0 then cachedActiveEventFloor = floorNum end
                elseif lowLvl:find("portal") then
                    mode = "Portal"
                end
                mapName = lvlTxt
            elseif mLbl and mLbl:IsA("TextLabel") and #mLbl.Text > 0 then
                mapName = mLbl.Text
            end
        end
    end)

    if status == "lobby" then
        cachedActiveTowerRoom = nil
        cachedActiveEventFloor = nil
    end

    return status, mode, mapName, waveStr
end

-- Wait for _stats + RAM inventory to load before taking initial match baseline
local startCurrencies, statsReady = readCurrencies()
local matchStartTime = os.time()
local sentForCurrentMatch = false
local matchBaseline = {
    currencies = {},
    itemsByName = {},
    unitsByName = {},
    traitRerolls = nil,
    hasItems = false,
    hasUnits = false,
}

local function captureMatchBaseline(forceScan)
    local cur, ready = readCurrencies()
    local gcRes = scanGcFullInventoryIfDue(forceScan == true)
    if gcRes and type(gcRes.profileCur) == "table" then
        for k, v in pairs(gcRes.profileCur) do
            if cur[k] == nil or (cur[k] == 0 and v > 0) then
                cur[k] = v
                ready = true
            end
        end
    end
    if gcRes and type(gcRes.items) == "table" then
        for _, it in pairs(gcRes.items) do
            if it.name and it.name:lower():find("dawn coin") then
                cur["Dawn Coins"] = it.amount
                break
            end
        end
    end
    if ready then
        startCurrencies = cur
        statsReady = true
        matchBaseline.currencies = cur
    end
    if gcRes then
        if gcRes.traitRerolls ~= nil then
            matchBaseline.traitRerolls = gcRes.traitRerolls
        end
        if gcRes.complete then
            local imap = {}
            local anyItem = false
            for _, it in pairs(gcRes.portals or {}) do
                if it.name and tonumber(it.amount) then
                    anyItem = true
                    local prev = imap[it.name]
                    if not prev then
                        imap[it.name] = { amount = it.amount, category = it.category or "portal", rarity = it.rarity or "Mythic" }
                    else
                        prev.amount = prev.amount + it.amount
                    end
                end
            end
            for _, it in pairs(gcRes.items or {}) do
                if it.name and tonumber(it.amount) then
                    anyItem = true
                    local prev = imap[it.name]
                    if not prev then
                        imap[it.name] = { amount = it.amount, category = it.category or "material", rarity = it.rarity or "Legendary" }
                    else
                        prev.amount = prev.amount + it.amount
                    end
                end
            end
            if anyItem then
                matchBaseline.itemsByName = imap
                matchBaseline.hasItems = true
            end
        end
        if type(gcRes.units) == "table" and #gcRes.units > 0 then
            local umap = {}
            for _, u in ipairs(gcRes.units) do
                if u.name and tonumber(u.amount) then
                    local prev = umap[u.name]
                    if not prev then
                        umap[u.name] = { amount = u.amount, rarity = u.rarity or "Mythic" }
                    else
                        prev.amount = prev.amount + u.amount
                    end
                end
            end
            matchBaseline.unitsByName = umap
            matchBaseline.hasUnits = true
        end
    end
end

captureMatchBaseline(true)

-- 1. Heartbeat loop (every 45s) + Fast watcher when Items GUI is open
local lastQuickSync = 0
local lastItemSig = ""

local function attachProfileMetadata(cur, gcObj)
    local rr = (type(gcObj) == "table" and gcObj.traitRerolls ~= nil) and gcObj.traitRerolls or cachedTraitRerolls
    local totRr = (type(gcObj) == "table" and gcObj.totalTraitRerolls ~= nil) and gcObj.totalTraitRerolls or cachedTotalTraitRerolls
    local srem = (type(gcObj) == "table" and type(gcObj.starRemnants) == "table") and gcObj.starRemnants or cachedStarRemnants
    local bp = (type(gcObj) == "table" and type(gcObj.battlePass) == "table") and gcObj.battlePass or cachedBattlePass
    local tw = (type(gcObj) == "table" and type(gcObj.towerData) == "table") and gcObj.towerData or cachedTowerData

    if rr ~= nil then cur["Trait Reroll"] = rr end
    if totRr ~= nil then cur["_total_trait_rerolls"] = totRr end
    if type(srem) == "table" then
        cur["Star Remnant"] = srem.total or 0
        cur["_star_remnant_limited"] = srem.limited or 0
        cur["_star_remnant_regular"] = srem.regular or 0
    end
    if type(bp) == "table" then
        cur["_battlepass"] = bp
    end
    if type(tw) == "table" or cachedActiveTowerRoom or cachedActiveEventFloor then
        local towerOut = {}
        if type(tw) == "table" then
            for k, v in pairs(tw) do towerOut[k] = v end
        else
            local guiTower = readTowerGuiInfo()
            if guiTower.gui_room then towerOut.infinite_room = guiTower.gui_room end
            if guiTower.season then towerOut.season = guiTower.season end
            if guiTower.rank_title then towerOut.rank_title = guiTower.rank_title end
            if guiTower.rank_pct then towerOut.rank_pct = guiTower.rank_pct end
            if guiTower.event_name then towerOut.event_name = guiTower.event_name end
            if guiTower.event_world then towerOut.event_world = guiTower.event_world end
            if guiTower.event_cleared ~= nil then towerOut.event_cleared = guiTower.event_cleared end
            if guiTower.event_rank_pct then towerOut.event_rank_pct = guiTower.event_rank_pct end
            if guiTower.event_rank then towerOut.event_rank = guiTower.event_rank end
        end
        if cachedActiveTowerRoom then towerOut.active_room = cachedActiveTowerRoom end
        if cachedActiveEventFloor then towerOut.active_event_floor = cachedActiveEventFloor end
        if next(towerOut) ~= nil then
            cur["_tower"] = towerOut
        end
    end
end

local function sendHeartbeatNow(itemsList, unitsOverride, completeOverride)
    local status, mode, mapName, waveStr = detectState()
    local cur, ready = readCurrencies()
    if ready and not statsReady then
        captureMatchBaseline(false)
    end
    if ready then
        local usefulItems, gcUnits, gcComplete
        if itemsList then
            usefulItems = itemsList
            gcUnits = unitsOverride or cachedGcUnits
            gcComplete = completeOverride == true
        else
            local _saw
            usefulItems, _saw, gcUnits, gcComplete = readUsefulItems(true)
        end

        for _, it in ipairs(usefulItems) do
            if it.name and it.name:lower():find("dawn coin") then
                cur["Dawn Coins"] = it.amount
            end
        end

        attachProfileMetadata(cur, nil)

        if gcComplete and not matchBaseline.hasItems and not sentForCurrentMatch then
            captureMatchBaseline(false)
        end

        local equippedTeam = readEquippedTeam()
        if type(gcUnits) == "table" and #gcUnits > 0 and #equippedTeam > 0 then
            local eqLvlByName = {}
            for _, eq in ipairs(equippedTeam) do
                if eq.name and eq.level then
                    local k = tostring(eq.name):lower()
                    if not eqLvlByName[k] or eq.level > eqLvlByName[k] then
                        eqLvlByName[k] = eq.level
                    end
                end
            end
            for _, u in ipairs(gcUnits) do
                if u.equipped and u.name then
                    local bestEq = eqLvlByName[tostring(u.name):lower()]
                    if bestEq and (not u.level or bestEq > u.level) then
                        u.level = bestEq
                    end
                end
            end
        end

        postIngest({
            event_type = "heartbeat",
            status = status,
            current_mode = mode,
            current_map = mapName,
            current_wave = waveStr,
            currencies = cur,
            items = usefulItems,
            items_complete = gcComplete,
            units = (type(gcUnits) == "table" and #gcUnits > 0) and gcUnits or nil,
            team = equippedTeam
        })
    end
end

task.spawn(function()
    while true do
        sendHeartbeatNow(nil, nil, nil)
        task.wait(45)
    end
end)

task.spawn(function()
    while true do
        pcall(function()
            local pg = LocalPlayer:FindFirstChild("PlayerGui")
            local itemsGui = pg and pg:FindFirstChild("items")
            if itemsGui and itemsGui.Enabled then
                local itemsList, sawAny, gcUnits, isComplete = readUsefulItems(false)
                if sawAny then
                    local parts = {}
                    for _, it in ipairs(itemsList) do
                        table.insert(parts, (it.category or "i") .. ":" .. it.name .. "=" .. tostring(it.amount) .. ":" .. tostring(it.tier or ""))
                    end
                    table.sort(parts)
                    local sig = table.concat(parts, "|")
                    if sig ~= lastItemSig and (os.time() - lastQuickSync) >= 4 then
                        lastItemSig = sig
                        lastQuickSync = os.time()
                        sendHeartbeatNow(itemsList, gcUnits, isComplete)
                    end
                end
            end
        end)
        task.wait(1.2)
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
                -- Wait 3.5s for server to finish crediting _stats & RAM inventory after ResultsUI opens
                task.wait(3.5)
                local duration = math.max(1, os.time() - matchStartTime)
                local _, mode, mapName, _ = detectState()
                local endCurrencies, endReady = readCurrencies()
                local endGc = scanGcFullInventoryIfDue(true)
                if endGc and type(endGc.profileCur) == "table" then
                    for k, v in pairs(endGc.profileCur) do
                        if endCurrencies[k] == nil or (endCurrencies[k] == 0 and v > 0) then
                            endCurrencies[k] = v
                            endReady = true
                        end
                    end
                end
                local endItemsList = nil
                if endGc then
                    endItemsList = {}
                    for _, it in pairs(endGc.portals or {}) do
                        table.insert(endItemsList, it)
                    end
                    for _, it in pairs(endGc.items or {}) do
                        if it.name and it.name:lower():find("dawn coin") then
                            endCurrencies["Dawn Coins"] = it.amount
                        end
                        table.insert(endItemsList, it)
                    end
                end

                local rewards = {}
                local seenRewardNames = {}
                if statsReady and endReady then
                    for k, endVal in pairs(endCurrencies) do
                        if string.sub(k, 1, 1) ~= "_" then
                            local baseVal = matchBaseline.currencies[k]
                            if baseVal ~= nil then
                                local diff = endVal - baseVal
                                if diff > 0 then
                                    seenRewardNames[k:lower()] = true
                                    table.insert(rewards, {
                                        name = k,
                                        amount = diff,
                                        category = "currency",
                                        rarity = k:lower():find("dawn") and "Mythic" or "common"
                                    })
                                end
                            end
                        end
                    end
                end

                -- Diff Trait Rerolls directly from RAM profile
                if matchBaseline.traitRerolls ~= nil and endGc and endGc.traitRerolls ~= nil then
                    local rrDiff = endGc.traitRerolls - matchBaseline.traitRerolls
                    if rrDiff > 0 then
                        seenRewardNames["trait reroll"] = true
                        table.insert(rewards, {
                            name = "Trait Reroll",
                            amount = rrDiff,
                            category = "material",
                            rarity = "Mythic"
                        })
                    end
                end

                -- Diff ALL inventory items (Stars, Materials, Relics, Portals, Keys, Skins, XP Food) gained during the match
                if matchBaseline.hasItems and endGc and endGc.complete then
                    local endMap = {}
                    for _, it in pairs(endGc.portals or {}) do
                        if it.name and tonumber(it.amount) then
                            local prev = endMap[it.name]
                            if not prev then
                                endMap[it.name] = { amount = it.amount, category = it.category or "portal", rarity = it.rarity or "Mythic" }
                            else
                                prev.amount = prev.amount + it.amount
                            end
                        end
                    end
                    for _, it in pairs(endGc.items or {}) do
                        if it.name and tonumber(it.amount) then
                            local prev = endMap[it.name]
                            if not prev then
                                endMap[it.name] = { amount = it.amount, category = it.category or "material", rarity = it.rarity or "Legendary" }
                            else
                                prev.amount = prev.amount + it.amount
                            end
                        end
                    end
                    for dispName, info in pairs(endMap) do
                        local baseAmt = (matchBaseline.itemsByName[dispName] and matchBaseline.itemsByName[dispName].amount) or 0
                        local diff = info.amount - baseAmt
                        local low = dispName:lower()
                        if diff > 0 and not seenRewardNames[low] and not low:find("dawn coin") then
                            seenRewardNames[low] = true
                            table.insert(rewards, {
                                name = dispName,
                                amount = diff,
                                category = info.category,
                                rarity = info.rarity
                            })
                        end
                    end
                end

                -- Diff newly obtained Units gained during the match
                if matchBaseline.hasUnits and endGc and type(endGc.units) == "table" and #endGc.units > 0 then
                    local endUmap = {}
                    for _, u in ipairs(endGc.units) do
                        if u.name and tonumber(u.amount) then
                            local prev = endUmap[u.name]
                            if not prev then
                                endUmap[u.name] = { amount = u.amount, rarity = u.rarity or "Mythic" }
                            else
                                prev.amount = prev.amount + u.amount
                            end
                        end
                    end
                    for uName, info in pairs(endUmap) do
                        local baseAmt = (matchBaseline.unitsByName[uName] and matchBaseline.unitsByName[uName].amount) or 0
                        local diff = info.amount - baseAmt
                        if diff > 0 and not seenRewardNames[uName:lower()] then
                            seenRewardNames[uName:lower()] = true
                            table.insert(rewards, {
                                name = uName,
                                amount = diff,
                                category = "unit",
                                rarity = info.rarity
                            })
                        end
                    end
                end

                -- Scan ResultsUI labels for Win/Lose, LevelName, and genuine UI-only item drops (skip Unit EXP cards)
                local resultStatus = "Win"
                local unitDefsForSkip = getUnitDefs()
                local knownUnitNames = {}
                for _, def in pairs(unitDefsForSkip) do
                    if type(def) == "table" and type(def.name) == "string" then
                        knownUnitNames[def.name:lower()] = true
                    end
                end
                local equippedNamesLower = {}
                for _, eq in ipairs(readEquippedTeam()) do
                    if eq.name then equippedNamesLower[tostring(eq.name):lower()] = true end
                end

                for _, obj in ipairs(resultsUI:GetDescendants()) do
                    if obj:IsA("TextLabel") and obj.Visible and #obj.Text > 0 then
                        local txt = obj.Text
                        local low = txt:lower()
                        if low:find("defeat") or low:find("lose") then
                            resultStatus = "Lose"
                        elseif obj.Name == "LevelName" or obj.Name == "MapName" then
                            if low:find("dungeon") or low:find("depth") then
                                mode = "Dungeon"
                                mapName = txt
                            elseif low:find("portal") or low:find("sky") then
                                mode = "Portal"
                                mapName = txt
                            elseif mode ~= "Portal" and not low:find("ultimate fighting squadron") then
                                mapName = txt
                            end
                        end
                    elseif obj:IsA("Frame") or obj:IsA("ImageButton") or obj:IsA("ImageLabel") then
                        local fullLow = obj:GetFullName():lower()
                        local isUnitExpContainer = fullLow:find("units") or fullLow:find("unitframe") or fullLow:find("character") or fullLow:find("xpbar")
                        if not isUnitExpContainer then
                            -- Only treat as an item drop if it has an explicit item name + quantity label
                            local nLbl = obj:FindFirstChild("name", true) or obj:FindFirstChild("ItemName", true)
                            local qLbl = obj:FindFirstChild("Amount", true) or obj:FindFirstChild("Quantity", true) or obj:FindFirstChild("RewardQuantity", true) or obj:FindFirstChild("Count", true)
                            if nLbl and qLbl and nLbl:IsA("TextLabel") and qLbl:IsA("TextLabel") and #nLbl.Text > 0 and nLbl.Visible then
                                local itemName = nLbl.Text
                                local lowName = itemName:lower():match("^%s*(.-)%s*$")
                                local qtyLow = qLbl.Text:lower()
                                local isExpText = qtyLow:find("xp") or qtyLow:find("exp") or qtyLow:find("lv") or qtyLow:find("/")
                                local isUnitCard = knownUnitNames[lowName] or equippedNamesLower[lowName]
                                local isJunk = isExpText or isUnitCard
                                    or lowName:find("victory") or lowName:find("defeat") or lowName:find("score")
                                    or lowName:find("first completion") or lowName:find("placeholder")
                                    or lowName:find("xp") or lowName:find("exp")
                                    or lowName:find("bonus") or lowName:find("wave") or lowName:find("time")
                                    or lowName:find("damage") or lowName:find("takedown") or lowName:find("kill")
                                    or lowName:find("level")
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
                end

                if endReady then
                    attachProfileMetadata(endCurrencies, endGc)
                end

                postIngest({
                    event_type = "run_complete",
                    mode = mode,
                    map_name = mapName,
                    result = resultStatus,
                    duration_sec = duration,
                    rewards = rewards,
                    currencies = endReady and endCurrencies or nil,
                    items = endItemsList,
                    items_complete = endGc and endGc.complete or false,
                    units = (endGc and type(endGc.units) == "table" and #endGc.units > 0) and endGc.units or nil,
                    team = readEquippedTeam()
                })
            elseif resultsUI and not resultsUI.Enabled and sentForCurrentMatch then
                -- Reset baseline cleanly for next round (Replay pressed)
                sentForCurrentMatch = false
                matchStartTime = os.time()
                captureMatchBaseline(true)
            end
        end)
        task.wait(2)
    end
end)

print("[AA Tracker] Connected as " .. tostring(cfg.BOT_NAME))
