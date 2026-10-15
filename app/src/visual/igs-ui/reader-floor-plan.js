import { createNarrationSpriteTracker, otherNamesOf } from '../../scene/narration-sprite.js';
import { extractSceneDirectives, resolveCharacterKey, narrativeRanges, prepareIllustrationPages } from '../../scene/scene-directives.js';
import { createOutfitResolver } from '../../scene/character-outfits.js';
import { extractFxDirectives, createFxPageResolver } from '../../scene/fx-directives.js';
import { applyDiceToHits } from '../../scene/battle-context.js';
import { parseChatMarker } from '../../scene/chat-blocks.js';
import { liveFallbackOf, withLiveFallback } from '../../scene/live-context.js';
import { withStormCarry } from '../../scene/storm-context.js';
import { stripBilingualTranslation } from './bilingual-text.js';
import { isSystemRole } from './system-role.js';
import { prepareEventCgPages } from '../../scene/event-cg.js';
import { normalizeItemName } from '../../data/shujuku/item-catalog.js';

export function stripSegmentSpeaker(text) {
    return String(text || '').trim().replace(/^\*+|\*+$/g, '').replace(/^\s*\[[^\]\n]*\][：:]\s*/, '');
}

export function stripWrappingQuotes(value) {
    const source = String(value == null ? '' : value).trim();
    if (source.length < 2) return source;
    for (const [open, close] of [['“', '”'], ['‘', '’'], ['「', '」'], ['『', '』'], ['"', '"'], ["'", "'"]]) {
        if (source.startsWith(open) && source.endsWith(close)) return source.slice(open.length, -close.length).trim();
    }
    return source;
}

export function lastBefore(entries, offset, inclusive = true) {
    let lo = 0, hi = entries.length;
    while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (inclusive ? entries[mid].offset <= offset : entries[mid].offset < offset) lo = mid + 1;
        else hi = mid;
    }
    return lo ? entries[lo - 1] : null;
}

// 宽松文本与原文下标的映射每楼最多构造一次；所有分页与 CG 定位共用。
export function createFloorSourceLocator(source) {
    const src = String(source || '');
    const ranges = narrativeRanges(src);
    const zones = ranges.length ? ranges : [[0, src.length]];
    let flat = null, positions = null;
    let looseBuilds = 0;
    function locate(text, from = 0, end = src.length) {
        const needle = String(text || '').trim();
        if (!needle) return -1;
        const start = Math.max(0, Number(from) || 0);
        const exact = src.indexOf(needle, start);
        if (exact >= 0 && exact + needle.length <= end) return exact;
        const loose = needle.replace(/[\s*（）\[\]]+/g, '');
        if (!loose) return -1;
        if (flat === null) {
            const chars = [], map = [];
            for (let i = 0; i < src.length; i += 1) {
                if (/[\s*（）\[\]]/.test(src[i])) continue;
                chars.push(src[i]); map.push(i);
            }
            flat = chars.join(''); positions = map; looseBuilds += 1;
        }
        let lo = 0, hi = positions.length;
        while (lo < hi) { const mid = (lo + hi) >>> 1; if (positions[mid] < start) lo = mid + 1; else hi = mid; }
        const hit = flat.indexOf(loose, lo);
        return hit >= 0 && positions[hit + loose.length - 1] < end ? positions[hit] : -1;
    }
    function segment(text, from = 0) {
        const plain = stripSegmentSpeaker(text);
        for (const [start, end] of zones) {
            if (end <= from) continue;
            // 正文先找，避免格式化说话人前缀注定不命中却先做一次整楼宽松扫描。
            let hit = locate(plain, Math.max(start, from), end);
            if (hit < 0 && plain !== text) hit = locate(text, Math.max(start, from), end);
            if (hit >= 0) return hit;
        }
        return -1;
    }
    return { locate, segment, get looseBuilds() { return looseBuilds; } };
}

const normalizeFingerprint = (s) => stripBilingualTranslation(s)
    .replace(/\*（[^）]*）\*/g, '').replace(/[\[\]\*（）]/g, '').replace(/\s+/g, '').trim();

// 只准备可复用的正文数据和资源身份；不在这里读取或永久保存 blob URL。
export function prepareReaderFloor({ text, segments, extracted, payload, scene, readerSettings, userName = '' }) {
    const sceneAssets = readerSettings._sceneAssets || null;
    const sceneDirectives = Array.isArray(extracted.sceneDirectives) ? extracted.sceneDirectives
        : Array.isArray(payload.sceneDirectives) ? payload.sceneDirectives : [];
    const hasIgsDirectives = sceneDirectives.length > 0;
    const source = String(extracted.markerLayoutSource || payload.raw || text || '');
    const locator = createFloorSourceLocator(source);
    let held = -1;
    const locatedOffsets = [];
    const offsets = segments.map((segment) => {
        const found = locator.segment(segment, held < 0 ? 0 : held + 1);
        locatedOffsets.push(found);
        if (found >= 0) held = found;
        return held;
    });
    const inheritedSceneState = payload.inheritedSceneState && payload.inheritedSceneState.scene
        ? { ...payload.inheritedSceneState, lastDirectiveType: 'scene' } : null;
    const outfitDirectives = extractSceneDirectives(source, { outfitResolver: createOutfitResolver(sceneAssets) }).directives;
    const scenes = outfitDirectives.filter(d => d.type === 'scene');
    const sceneAt = (offset) => {
        const own = offset >= 0 ? lastBefore(scenes, offset, false) : null;
        return own && own.scene ? { ...own, character: '', mood: '', lastDirectiveType: 'scene' } : inheritedSceneState;
    };
    const sceneStates = offsets.map(sceneAt);
    const dread = Array.from(source.matchAll(/\[igs-dread:\s*([0-3])\s*\]/g), m => ({ offset: m.index, value: Number(m[1]) }));
    const charThoughtDirectives = sceneDirectives.filter(d => d.type === 'char' || d.type === 'thought');
    const fingerprints = new Map(charThoughtDirectives.map(d => [d, normalizeFingerprint(d.type === 'thought' ? d.thought : d.dialogue)]));
    const bySpeaker = new Map(), speechByPage = new Map(), byFingerprint = new Map();
    for (const d of charThoughtDirectives) {
        if (!bySpeaker.has(d.character)) bySpeaker.set(d.character, []);
        bySpeaker.get(d.character).push(d);
        const fingerprint = fingerprints.get(d);
        if (!byFingerprint.has(fingerprint)) byFingerprint.set(fingerprint, []);
        byFingerprint.get(fingerprint).push(d);
        const index = Number(d.segmentIndex);
        if (!speechByPage.has(index)) speechByPage.set(index, []);
        speechByPage.get(index).push(d);
    }
    const latestSpeechByPage = [];
    let latestSpeech = null;
    for (let i = 0; i < segments.length; i++) {
        if (speechByPage.has(i)) latestSpeech = speechByPage.get(i).find(d => d.character) || latestSpeech;
        latestSpeechByPage.push(latestSpeech);
    }
    const thoughtPages = new Map();
    for (const d of charThoughtDirectives) {
        if (d.type !== 'thought') continue;
        const start = Number(d.segmentIndex), thought = fingerprints.get(d);
        if (!Number.isInteger(start) || start < 0 || !thought) continue;
        let consumed = '';
        for (let i = start; i < segments.length; i++) {
            const m = String(segments[i] || '').match(/^\s*\*+\s*([\s\S]*?)\s*\*+\s*$/);
            const part = m ? normalizeFingerprint(m[1]) : '';
            if (!part || !thought.startsWith(consumed + part)) break;
            consumed += part;
            if (!thoughtPages.has(i)) thoughtPages.set(i, d);
        }
    }
    const keyMemo = new Map();
    const keyOf = name => {
        if (!keyMemo.has(name)) keyMemo.set(name, resolveCharacterKey(sceneAssets?.characters, sceneAssets?.characterAliases, name) || name);
        return keyMemo.get(name);
    };
    const thoughtCharacters = new Set(charThoughtDirectives.filter(d => d.type === 'thought').map(d => keyOf(d.character)));
    const othersMemo = new Map();
    const othersFor = key => {
        if (!othersMemo.has(key)) othersMemo.set(key, otherNamesOf(sceneAssets?.characters, sceneAssets?.characterAliases, key, [userName]));
        return othersMemo.get(key);
    };
    let lastBubble = null;
    let narrationTracker = null;
    const pages = [];
    for (let normalizedIndex = 0; normalizedIndex < segments.length; normalizedIndex++) {
        const currentText = segments[normalizedIndex];
        const sceneStateForBg = sceneStates[normalizedIndex];
        if (!sceneAssets?.enabled) {
            pages.push({ textType: 'narration', bubbleSpeaker: '', bubbleMood: '', segmentBody: currentText,
                spriteChar: '', spriteMood: '', systemSpeaker: '', currentOffset: offsets[normalizedIndex], sceneStateForBg });
            continue;
        }
        let textType = 'narration', bubbleSpeaker = '', bubbleMood = '', segmentBody = currentText;
        let spriteMood = '', systemSpeaker = '', spriteLeft = false;
        // Match this bubble back to its directive by speaker + dialogue/thought text
        // fingerprint, not by row ordinal. Reformatting (image blocks, italic narration,
        // merged/stripped lines) desyncs any positional counter, so we look the source
        // text up directly. normalizeFingerprint strips the translation tail *（…）*,
        // bilingual 〖…〗 translations, brackets and whitespace so a substring compare is stable.
        // 严格认领：整句相等，或当前段不少于 6 字且是指令原文的片段。
        // 12 字前缀的双向包含会让「……」「嗯。」这类短台词认领以它开头或含它的旁白，只能用于已判定类型的段补情绪。
        const textMatchesDirective = (bodyKey, d) => {
            const src = fingerprints.get(d);
            if (!bodyKey || !src) return false;
            return bodyKey === src || (bodyKey.length >= 6 && src.includes(bodyKey));
        };
        const findDirectiveByText = (speaker, body, match = {}) => {
            const bodyKey = normalizeFingerprint(body);
            if (!bodyKey) return null;
            const exactMatches = (byFingerprint.get(bodyKey) || []).filter(d => (!speaker || d.character === speaker) && (!match.type || d.type === match.type));
            const exact = lastBefore(exactMatches, offsets[normalizedIndex]) || exactMatches[0];
            if (exact) return exact;
            const probe = bodyKey.slice(0, 12);
            const pool = (speaker ? bySpeaker.get(speaker) || [] : charThoughtDirectives).filter((d) => !match.type || d.type === match.type);
            for (const d of pool) {
                if (match.strict) {
                    if (textMatchesDirective(bodyKey, d)) return d;
                    continue;
                }
                const src = fingerprints.get(d);
                if (src && (src.includes(probe) || probe.includes(src.slice(0, 12)))) return d;
            }
            return null;
        };
        // 分页后的短心理话不足六字，不能靠全文子串匹配认领。仅从该
        // 指令的可见起始页连续消费 *…* 页；一旦越过原文或遇到旁白就停止。
        const findPagedThought = () => thoughtPages.get(normalizedIndex) || null;
        const classifySegment = (segText) => {
            // 没有任何 [igs-*:] 指令时禁止按文本外形猜测台词/心理话，统一按旁白兜底。
            if (!hasIgsDirectives) return null;
            const seg = String(segText || '');
            const tMatch = seg.match(/^\s*\*\s*(?:\[([^\]]+)\]\s*[:：]\s*)?([\s\S]*?)\s*\*\s*$/);
            const dMatch = seg.match(/^\s*\[([^\]]+)\]\s*[:：]\s*([\s\S]*)$/);
            if (tMatch) {
                let sp = tMatch[1] ? tMatch[1].trim() : '';
                // 正文可能写作 **…**（成对双星号），匹配指令前剥掉残留星号。
                const bodyText = String(tMatch[2] || '').replace(/^\s*\*+\s*/, '').replace(/\s*\*+\s*$/, '').trim();
                // 无角色名的 *…* 也可能是 AI 的斜体旁白：只有严格对上某条心里话指令才算心理活动。
                const matched = sp
                    ? findDirectiveByText(sp, bodyText) || findDirectiveByText(sp, tMatch[2])
                    : findDirectiveByText('', bodyText, { strict: true, type: 'thought' })
                        || (seg === currentText ? findPagedThought() : null);
                if (!sp && !matched) return null;
                if (!sp) sp = matched.character || '';
                return { textType: 'thought', speaker: sp, mood: matched ? (matched.mood || '') : '', body: seg };
            }
            if (dMatch) {
                const sp = dMatch[1].trim();
                const matched = findDirectiveByText(sp, dMatch[2]);
                return { textType: 'dialogue', speaker: sp, mood: matched ? (matched.mood || '') : '', body: stripWrappingQuotes(dMatch[2]) };
            }
            return null;
        };
        const classified = classifySegment(currentText);
        if (classified) {
            textType = classified.textType;
            bubbleSpeaker = classified.speaker;
            bubbleMood = classified.mood;
            segmentBody = classified.body;
        }
        // 兜底：段落缺「[名字]：」前缀（自定义格式化规则等）时找回说话人。
        // 段索引会错位、文本相似度会误认，两条路径都必须严格对上指令原文，旁白页不借用相邻台词。
        if (!bubbleSpeaker) {
            const probeKey = normalizeFingerprint(String(currentText || '')
                .replace(/^\s*\*+\s*/, '').replace(/\s*\*+\s*$/, '')
                .replace(/^\s*\[[^\]]+\]\s*[:：]\s*/, ''));
            const segDirective = (speechByPage.get(normalizedIndex) || []).find((d) => textMatchesDirective(probeKey, d));
            // 「……」「嗯。」这类短句旁白与台词可能逐字相同，不带段索引佐证时不按文本认领。
            const matchedDirective = segDirective
                || (probeKey.length >= 6 ? findDirectiveByText('', probeKey, { strict: true }) : null);

            if (matchedDirective) {
                textType = matchedDirective.type === 'thought' ? 'thought' : 'dialogue';
                bubbleSpeaker = matchedDirective.character || scene.speaker;
                bubbleMood = matchedDirective.mood || '';
            }
        }
        // 系统类角色的台词按独立旁白样式渲染：不显示立绘与状态栏角色，名字按设置决定。
        if (textType === 'dialogue' && isSystemRole(bubbleSpeaker, readerSettings.systemRole)) {
            textType = 'system';
            systemSpeaker = bubbleSpeaker;
            bubbleSpeaker = '';
            bubbleMood = '';
        }

        // Sprite resolves from the bubble's own speaker/mood, not the row-counted
        // segmentIndex (which desyncs once char/thought tags are reformatted into
        // visible bubble lines). Background still follows directive accumulation.
        let spriteChar = bubbleSpeaker;
        spriteMood = bubbleMood;
        // 旁白直接继承已准备的最近说话页，不再回扫前面的所有页。
        let inheritFrom = -1;
        if (!spriteChar && lastBubble) {
            spriteChar = lastBubble.speaker;
            spriteMood = lastBubble.mood;
            inheritFrom = lastBubble.index;
        }
        // 回溯也失败时（段落前缀被剥离，文本已不含「[名字]：」）按段索引取 char/thought 指令。
        // 只用于立绘继承，不改 textType，避免把旁白页误判成角色页。
        if (!spriteChar) {
            const d = latestSpeechByPage[normalizedIndex];
            if (d) {
                spriteChar = d.character;
                spriteMood = d.mood || '';
                if (Number(d.segmentIndex) < normalizedIndex) inheritFrom = Number(d.segmentIndex);
            }
        }
        // 旁白页沿用的立绘：写到这个人离开就清掉；离台词超过 2 页且旁白不再写这个人也收起（见 narration-sprite）。
        let narrationDropped = false;
        let narrationDroppedKey = '';
        if (spriteChar && inheritFrom >= 0) {
            const assetsForKey = sceneAssets || {};

            const key = keyOf(spriteChar);
            const aliasMap = assetsForKey.characterAliases && typeof assetsForKey.characterAliases === 'object' ? assetsForKey.characterAliases : {};
            const pov = (userName && keyOf(userName) === key)
                || thoughtCharacters.has(key);
            if (!narrationTracker || narrationTracker.key !== key || narrationTracker.anchor !== inheritFrom || narrationTracker.index !== normalizedIndex - 1) {
                narrationTracker = { key, anchor: inheritFrom, index: inheritFrom,
                    push: createNarrationSpriteTracker({ name: spriteChar, aliases: [key, ...(Array.isArray(aliasMap[key]) ? aliasMap[key] : [])], others: othersFor(key), pov }) };
                for (let i = inheritFrom + 1; i < normalizedIndex; i++) narrationTracker.push(segments[i]);
            }
            const keep = narrationTracker.push(currentText);
            narrationTracker.index = normalizedIndex;
            if (!keep) {
                spriteChar = '';
                spriteMood = '';
                narrationDropped = true;
                spriteLeft = true;
                narrationDroppedKey = key;
            }
        }
        if (!spriteChar && !narrationDropped && sceneStateForBg && sceneStateForBg.character) {
            // Fallback for untransformed/legacy paths where the bubble text still
            // carries the raw tag (no reformatted "[名字]：" line to parse).
            spriteChar = sceneStateForBg.character;
            spriteMood = sceneStateForBg.mood || '';
        }
        if (classified && classified.speaker) lastBubble = { ...classified, index: normalizedIndex };
        pages.push({ textType, bubbleSpeaker, bubbleMood, segmentBody, systemSpeaker, spriteChar, spriteMood,
            narrationDropped, narrationDroppedKey, spriteLeft, currentOffset: offsets[normalizedIndex], sceneStateForBg,
            sceneDread: (lastBefore(dread, offsets[normalizedIndex] < 0 ? source.length : offsets[normalizedIndex], false)?.value) ?? payload.inheritedDread ?? null });
    }
    const flags = sceneStates.map(s => Boolean(s && s.nsfw));
    for (let start = 0; start < pages.length;) {
        if (!flags[start]) { start++; continue; }
        let end = start;
        while (end + 1 < pages.length && flags[end + 1]) end++;
        for (let i = start; i <= end; i++) pages[i].nsfwSpan = {
            index: i - start, length: end - start + 1,
            continued: start === 0 && Boolean(payload.inheritedSceneState?.nsfw), endsInFloor: end < pages.length - 1,
        };
        start = end + 1;
    }
    const liveFallback = readerSettings.liveFx?.enabled === true ? liveFallbackOf(userName) : null;
    const rawFx = extractFxDirectives(source);
    const liveFx = liveFallback ? withLiveFallback(rawFx, source, payload.liveContext, liveFallback) : rawFx;
    const fxDirectives = payload.stormContext && readerSettings.feedFx?.enabled === true && readerSettings.feedFx?.storm?.enabled !== false
        ? withStormCarry(liveFx, payload.stormContext) : liveFx;
    const battleContext = payload.battleContext || null;
    const battleFx = battleContext ? applyDiceToHits(fxDirectives, battleContext.dice, userName) : fxDirectives;
    const cues = battleFx.filter(d => d.cue && d.kind === 'live');
    const feeds = battleFx.filter(d => d.kind === 'app' && !d.end);
    const fxForPage = createFxPageResolver(battleFx, battleContext);
    for (let i = 0; i < pages.length; i++) {
        let at = offsets[i];
        const prev = i ? offsets[i - 1] : -1;
        if (at < 0 && parseChatMarker(segments[i]) >= 0) {
            const chatStart = source.slice(prev + 1).search(/\[igs-(?:chat:|msg:)/);
            if (chatStart >= 0) at = prev + 1 + chatStart;
        }
        const next = i + 1 < pages.length ? locatedOffsets[i + 1] : Infinity;
        const paged = next > at && cues.some(d => d.offset > at && d.offset < next)
            ? battleFx.map(d => d.cue && d.kind === 'live' && d.offset > at && d.offset < next ? { ...d, offset: at } : d)
                .sort((a, b) => a.offset - b.offset) : battleFx;
        let feedNext = -1;
        if (at >= 0 && feeds.some(d => d.offset > at)) {
            feedNext = Infinity;
            for (let n = i + 1; n < pages.length; n++) if (locatedOffsets[n] > at) { feedNext = locatedOffsets[n]; break; }
        }
        pages[i].fxOffset = at;
        pages[i].fx = fxForPage(at, prev, feedNext, paged);
        if (battleContext) pages[i].fx.userName = userName;
    }
    const illustrations = prepareIllustrationPages({ source, offsets, segments, holdPages: readerSettings.cgHoldPages,
        inheritedNsfw: Boolean(payload.inheritedSceneState?.nsfw), sceneAt });
    const eventCgs = prepareEventCgPages({ source, segments, holdPages: readerSettings.cgHoldPages, eventCgs: sceneAssets?.eventCgs });
    const tagItems = fxDirectives.filter(d => d.kind === 'item').map(d => ({ action: d.args[0], name: d.args[1], description: d.args[2] || '' }));
    const itemTargets = new Map();
    const itemPageFor = name => {
        if (!itemTargets.has(name)) itemTargets.set(name, Math.max(0, segments.findIndex(text => String(text || '').includes(name))));
        return itemTargets.get(name);
    };
    return { text, segments, source, sceneDirectives, outfitDirectives, inheritedSceneState, pages, offsets,
        sceneAt, locator, keyOf, userName, sceneSpeaker: scene.speaker, latestSpeechByPage, fxDirectives, illustrations, eventCgs,
        tagItems, tagNames: new Set(tagItems.map(item => normalizeItemName(item.name))), itemPageFor, assets: null, tablesRevision: -1 };
}
