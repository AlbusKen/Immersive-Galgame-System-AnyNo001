import { resolveSpriteAsset, resolveBackgroundAsset, resolveNudeSpriteAsset, isNonSpriteSpeaker, tempAssetKeyOf } from '../../scene/asset-match.js';
import { resolveSpriteOutfit, outfitsOfCharacter } from '../../scene/character-outfits.js';
import { resolveCharacterDna } from '../../scene/character-dna.js';
import { classifySceneKey } from '../../scene/scene-directives.js';
import { narrationCastLeft, otherNamesOf } from '../../scene/narration-sprite.js';
import { STAGE_CAST_SCAN_LIMIT } from '../../scene/stage-cast.js';
import { normalizeStageCastSettings } from './stage-direction-settings.js';
import { isSystemRole } from './system-role.js';
import { lastBefore } from './reader-floor-plan.js';

// 页计划里的只有引用和命中结果。图像字节及 blob 生命周期仍属于中央媒体缓存。
function createAssetLookup(initialContext) {
    let context = initialContext;
    const entries = new Map();
    const dirty = new Map();
    const updated = new Map();
    function resolve(kind, args) {
        const key = JSON.stringify([kind, ...args]);
        const cached = entries.get(key);
        if (cached && (!cached.retryAt || Date.now() < cached.retryAt)) return cached.hit;
        const dependencies = new Set();
        const temporaryKeys = new Set(), backgroundPrefixes = new Set();
        let retryMs = 0;
        const probe = (fn, ms) => typeof fn === 'function' ? url => {
            dependencies.add(url);
            const failed = fn(url);
            if (failed) retryMs = Math.max(retryMs, ms);
            return failed;
        } : undefined;
        const temporary = (fn, type) => typeof fn === 'function' ? (name, time) => {
            const key = tempAssetKeyOf(context.chatId || '', { type, name, time: type === 'background' ? '' : time });
            (type === 'background' ? backgroundPrefixes : temporaryKeys).add(key);
            return fn(name, time);
        } : undefined;
        const ctx = { ...context,
            isMissingImage: probe(context.isMissingImage, 30000),
            isUnavailableImage: probe(context.isUnavailableImage, 1500),
            tempSprite: temporary(context.tempSprite, 'sprite'),
            tempBackground: temporary(context.tempBackground, 'background'),
            tempSceneTime: temporary(context.tempSceneTime, 'background') };
        const hit = kind === 'sprite' ? resolveSpriteAsset(args[0], args[1], ctx, args[2])
            : kind === 'nude' ? resolveNudeSpriteAsset(args[0], args[1], ctx)
                : resolveBackgroundAsset(args[0], ctx);
        if (hit.url) dependencies.add(hit.url);
        entries.set(key, { kind, args, hit, dependencies, temporaryKeys, backgroundPrefixes, retryAt: retryMs ? Date.now() + retryMs : 0 });
        if (hit.url && hit.url !== cached?.hit.url) updated.set(key, hit.url);
        return hit;
    }
    function invalidate(detail) {
        if (detail?.chatId != null && String(detail.chatId) !== String(context.chatId || '')) return;
        const id = detail?.imageId;
        const ref = id ? `igs-gen:${id}` : '';
        for (const [key, entry] of entries) {
            if (detail?.key && !entry.temporaryKeys.has(detail.key)
                && ![...entry.backgroundPrefixes].some(prefix => detail.key.startsWith(prefix))) continue;
            if (ref ? !entry.dependencies.has(ref) : detail?.reason === 'image-retry-ready' && !entry.retryAt) continue;
            dirty.set(key, entry);
            entries.delete(key);
        }
    }
    return { sprite: (name, mood = '', outfit = '') => resolve('sprite', [name, mood || '', outfit || '']),
        nude: (name, mood = '') => resolve('nude', [name, mood]),
        background: state => resolve('background', [{ scene: state.scene, time: state.time || '', weather: state.weather || '', nsfw: state.nsfw === true }]),
        updateContext(ctx) {
            context = ctx;
            const pending = [...dirty.values()]; dirty.clear();
            for (const entry of pending) resolve(entry.kind, entry.args);
        }, invalidate,
        takeUpdatedUrls() { const values = [...new Set(updated.values())]; updated.clear(); return values; },
        get urls() { return [...new Set([...entries.values()].map(entry => entry.hit.url).filter(Boolean))]; } };
}

// 名单、最近台词和换装时间线各建一次，按偏移取，避免每页回扫整楼。
function prepareStageIndex(floor, settings) {
    const cast = normalizeStageCastSettings(settings.stageCast);
    const members = new Map(), speeches = new Map(), outfits = new Map(), stages = [];
    let order = 0;
    for (const d of floor.outfitDirectives) {
        if (d.type === 'scene') { members.clear(); order = 0; stages.push({ offset: d.offset, members: [] }); continue; }
        if (d.type !== 'char' && d.type !== 'thought') continue;
        const key = floor.keyOf(d.character);
        if (!speeches.has(key)) speeches.set(key, []);
        speeches.get(key).push(d);
        if (d.outfit) {
            const outfitKey = outfitsOfCharacter(settings._sceneAssets?.characterOutfits, settings._sceneAssets?.characterAliases, d.character).key || d.character;
            if (!outfits.has(outfitKey)) outfits.set(outfitKey, []);
            outfits.get(outfitKey).push(d);
        }
        if (!cast.enabled || isNonSpriteSpeaker(d.character) || isSystemRole(d.character, settings.systemRole)) continue;
        const previous = members.get(key);
        members.delete(key);
        members.set(key, { character: key, mood: String(d.mood || '').trim(), order: previous ? previous.order : order++, at: Number(d.offset) });
        if (members.size > STAGE_CAST_SCAN_LIMIT) members.delete(members.keys().next().value);
        stages.push({ offset: d.offset, members: [...members.values()].reverse() });
    }
    const reacts = new Map(), all = [];
    for (const d of floor.fxDirectives) {
        if (d.kind !== 'react' || !d.args?.[0]) continue;
        if (d.args[0] === '全员') all.push(d);
        else {
            const key = floor.keyOf(d.args[0]);
            if (!reacts.has(key)) reacts.set(key, []);
            reacts.get(key).push(d);
        }
    }
    floor.stageIndex = { stages, speeches, outfits };
    const assets = settings._sceneAssets || {};
    const otherNames = otherNamesOf(assets.characters, assets.characterAliases, '', [floor.userName]);
    for (let i = 0; i < floor.pages.length; i++) {
        const page = floor.pages[i];
        const anchor = floor.latestSpeechByPage[i];
        page.outfitOffset = page.currentOffset >= 0 ? page.currentOffset
            : anchor ? floor.locator.locate(anchor.thought || anchor.dialogue) : -1;
        const offset = page.outfitOffset;
        const at = offset >= 0 ? offset : page.fxOffset;
        page.reactMoodOf = name => {
            if (!(at >= 0) || !cast.enabled || !cast.castReact) return '';
            const key = floor.keyOf(name);
            const own = lastBefore(reacts.get(key) || [], at), everyone = lastBefore(all, at);
            const pick = own && everyone ? (own.offset >= everyone.offset ? own : everyone) : own || everyone;
            const speech = lastBefore(speeches.get(key) || [], at);
            return pick && pick.offset > (speech?.offset ?? -1) ? String(pick.args[1] || '').trim() : '';
        };
        const gone = new Map();
        if (cast.castStage) for (const [name, goneAt] of Object.entries(page.fx.goneAt || {})) {
            const key = floor.keyOf(name);
            gone.set(key, Math.max(Number(goneAt), gone.get(key) ?? -1));
        }
        page.cast = !(offset >= 0) || !cast.enabled ? [] : (lastBefore(stages, offset)?.members || []).filter(m => {
            if (m.character === page.narrationDroppedKey || (gone.has(m.character) && m.at < gone.get(m.character))) return false;
            if (m.character === floor.keyOf(page.spriteChar)) return true;
            const speech = lastBefore(speeches.get(m.character) || [], offset);
            if (!speech) return true;
            const end = floor.source.indexOf('\n', speech.offset);
            return !narrationCastLeft({ name: m.character, aliases: assets.characterAliases?.[m.character] || [],
                others: otherNames.filter(n => n !== m.character), text: floor.source.slice(end < 0 ? speech.offset : end, offset) });
        });
    }
}

export function prepareReaderFloorAssets(floor, { payload, readerSettings, assetMatchCtx, tableData }) {
    const stageSettings = JSON.stringify(readerSettings.stageCast);
    const hudSettings = JSON.stringify([readerSettings.statusHud?.enabled, readerSettings.statusHud?.tables]);
    const strict = assetMatchCtx.strict === true;
    if (floor.assets && floor.tablesRevision === tableData.revision && floor.stageSettings === stageSettings
        && floor.hudSettings === hudSettings && floor.matchStrict === strict) {
        floor.assets.updateContext(assetMatchCtx);
        return floor.assets;
    }
    if (!floor.stageIndex || floor.stageSettings !== stageSettings) prepareStageIndex(floor, readerSettings);
    floor.stageSettings = stageSettings;
    floor.hudSettings = hudSettings;
    const sceneAssets = readerSettings._sceneAssets || {};
    if (readerSettings.statusHud?.enabled && readerSettings.statusHud.tables?.length) {
        const names = new Set(floor.sceneDirectives.filter(d => d.character).map(d => floor.keyOf(d.character)));
        if (floor.sceneSpeaker) names.add(floor.keyOf(floor.sceneSpeaker));
        tableData.prepareCharacters(names, readerSettings.statusHud.tables, sceneAssets.characterAliases);
    }
    const lookup = floor.assets || createAssetLookup(assetMatchCtx);
    if (floor.matchStrict !== strict) lookup.invalidate();
    floor.matchStrict = strict;
    lookup.updateContext(assetMatchCtx);
    const outfitCache = new Map();
    const scenes = floor.outfitDirectives.filter(d => d.type === 'scene');
    const inheritedOutfits = payload.inheritedOutfits;
    function outfitFor(index, character) {
        const page = floor.pages[index];
        const key = outfitsOfCharacter(sceneAssets.characterOutfits, sceneAssets.characterAliases, character).key || character;
        const tag = lastBefore(floor.stageIndex.outfits.get(key) || [], page.outfitOffset);
        const scene = lastBefore(scenes, page.outfitOffset);
        const cacheKey = JSON.stringify([key, tag?.offset ?? -1, scene?.offset ?? -1]);
        if (!outfitCache.has(cacheKey)) {
            const rawScene = String(page.sceneStateForBg?.scene || '').trim();
            outfitCache.set(cacheKey, resolveSpriteOutfit({ directives: [scene, tag].filter(Boolean), character,
                offset: page.outfitOffset, inheritedOutfits, sceneAssets,
                scene: [classifySceneKey(sceneAssets.scenes, rawScene).key || '', rawScene],
                readClues: tableData.outfitClues,
                resolveDna: name => resolveCharacterDna(sceneAssets.characterDna, name)?.dna || null }));
        }
        return outfitCache.get(cacheKey);
    }
    lookup.outfitFor = outfitFor;
    floor.assets = lookup;
    // 整楼需求先匹配好，缺图/恢复时只使相关命中失效，在用到它的页上精准补齐。
    if (sceneAssets.enabled) {
        if (floor.inheritedSceneState) lookup.background(floor.inheritedSceneState);
        for (let i = 0; i < floor.pages.length; i++) {
            const page = floor.pages[i];
            if (page.sceneStateForBg) lookup.background(page.sceneStateForBg);
            const people = [{ character: page.spriteChar, mood: page.spriteMood }, ...page.cast];
            for (const person of people) {
                if (!person.character) continue;
                const outfit = outfitFor(i, person.character).outfit;
                lookup.sprite(person.character, person.mood, outfit);
                const react = page.reactMoodOf(person.character);
                if (react) lookup.sprite(person.character, react, outfit);
                if (page.fx.poses?.[person.character]?.back) lookup.sprite(person.character, '背影', outfit);
            }
            if (page.sceneStateForBg?.nsfw && page.bubbleSpeaker) lookup.nude(page.bubbleSpeaker, page.bubbleMood);
            if (page.fx.battle?.foe) lookup.sprite(page.fx.battle.foe);
        }
    }
    floor.tablesRevision = tableData.revision;
    return lookup;
}
