import { normalizeCharacterDna } from './character-dna.js';
import { checkPromptTask, checkPromptOutput, promptTaskForSlot } from '../schemas/prompt-recipe.js';
import { checkCharacterMeta } from '../schemas/character-meta.js';
import { resolveCharacterKey } from './scene-directives.js';
import { isValidOutfitName, resolveSpriteOutfit, resolveWardrobePrompt } from './character-outfits.js';

// 沿用既有别名解析；请求内去重，不从 caption 顺序猜身份。
export function buildCharacterContext(names, assets = {}, options) {
    const known = { ...assets.characterDna, ...assets.characters, ...assets.characterOutfits, ...assets.generated?.characters };
    const seen = new Set();
    return (names || []).flatMap((name) => {
        const characterKey = resolveCharacterKey(known, assets.characterAliases || {}, name) || String(name || '').trim();
        if (!characterKey || ['__proto__', 'constructor', 'prototype'].includes(characterKey) || seen.has(characterKey)) return [];
        seen.add(characterKey);
        const dna = normalizeCharacterDna(assets.characterDna?.[characterKey]);
        let outfit = { name: '', description: '' };
        if (options) {
            const resolved = resolveSpriteOutfit({ ...options, character: characterKey, sceneAssets: assets,
                resolveDna: (key) => normalizeCharacterDna(assets.characterDna?.[key]) });
            const entry = assets.characterOutfits?.[characterKey]?.[resolved.outfit];
            if (resolved.outfit) outfit = { name: resolved.outfit,
                description: resolveWardrobePrompt(assets.wardrobe, entry, resolved.outfit)?.prompt || '' };
        }
        return [{ characterKey, dna, outfit }];
    });
}

// 新候选采用与旧完整词采用分开：成功图片的旁路是证据，不从图片或正文猜身份。
export function prepareSpriteIdentityAdoption(assets, name, imageId, record = {}, { sourceName = name, hadDefault = false } = {}) {
    const fail = (reason, error = '立绘身份资料已变化或无法核验，请重新生成；原资料保持不变') => ({ ok: false, reason, error });
    if (record.promptEdited === true || record.edited === true) {
        if (record.dnaCandidates !== undefined) return fail('DNA_ADOPTION_INVALID');
        return { ok: true, patch: {
            characterDna: assets.characterDna || {}, characterOutfits: assets.characterOutfits || {}, wardrobe: assets.wardrobe || {},
        } };
    }
    if (record.dnaCandidates === undefined) {
        if (record.identityContext) {
            const source = record.identityContext.filter((c) => c.characterKey === sourceName);
            if (source.length !== 1 || JSON.stringify(normalizeCharacterDna(assets.characterDna?.[name]))
                !== JSON.stringify(normalizeCharacterDna(source[0].dna))) return fail('DNA_ADOPTION_CONFLICT');
        }
        // 新模板没有候选时不得用旧 identityAnchor 建档。
        const patch = record.promptRecipe ? {
            characterDna: assets.characterDna || {}, characterOutfits: assets.characterOutfits || {}, wardrobe: assets.wardrobe || {},
        } : adoptSpriteIdentity(assets, name, imageId, record.characterMeta, { hadDefault });
        return { ok: true, patch };
    }
    if (!imageId || record.promptEdited === true || record.edited === true || !record.sentPrompt
        || !record.promptRecipe || !Array.isArray(record.identityContext)) return fail('DNA_ADOPTION_INVALID');
    const context = record.identityContext;
    const source = context.filter((c) => c.characterKey === sourceName);
    if (source.length !== 1) return fail('DNA_TEMPLATE_BINDING');
    const task = checkPromptTask(record.promptTask, context);
    if (!task.ok || task.value?.purpose !== 'sprite') return fail('PROMPT_MODE_CONFLICT');
    const caption = record.promptRecipe.caption;
    const meta = checkCharacterMeta(record.characterMeta, caption, [sourceName]);
    if (!meta.ok) return meta;
    const output = checkPromptOutput({ ...record, caption, characterMeta: meta.value }, task.value, context);
    if (!output.ok) return output;
    const candidates = output.value.dnaCandidates?.characters;
    if (candidates?.length !== 1 || candidates[0].characterKey !== sourceName) return fail('DNA_TEMPLATE_BINDING');
    const dna = normalizeCharacterDna(assets.characterDna?.[name]);
    if (JSON.stringify(dna) !== JSON.stringify(normalizeCharacterDna(source[0].dna))) return fail('DNA_ADOPTION_CONFLICT');
    const candidate = candidates[0];
    const snapshot = record.dnaSnapshot?.characters?.filter((c) => c.characterKey === sourceName && c.source === 'candidate');
    if (record.dnaSnapshot?.version !== 1 || snapshot?.length !== 1
        || JSON.stringify(normalizeCharacterDna(snapshot[0].profile).views) !== JSON.stringify(candidate.views)) return fail('DNA_ADOPTION_INVALID');
    // 显式立绘转换可补齐旧身份的景别，但旧字段及已存在景别必须原样保留。
    const nextDna = { ...dna, version: 2, views: structuredClone({ ...dna.views, ...candidate.views }),
        identityInitialized: true, identitySource: dna.identitySource || imageId };
    const binding = meta.value.characters[0];
    const outfitPatch = adoptSpriteIdentity({ ...assets, characterDna: { ...assets.characterDna, [name]: {} } },
        name, imageId, { version: 1, characters: [{ ...binding, characterKey: name }] });
    return { ok: true, patch: { ...outfitPatch, characterDna: { ...assets.characterDna, [name]: nextDna } } };
}

// 图片及临时记录使用同一份采用证据；不保存衣装上下文、凭据或请求全量。
export function spriteAdoptionEvidence(input = {}, result = {}) {
    if (input.promptTask?.purpose !== 'sprite') return {};
    const selected = promptTaskForSlot(input.promptTask, input.slotId);
    if (!selected.ok) return {};
    const keys = selected.value.characters.map((c) => c.characterKey);
    return { ...(result.dnaCandidates !== undefined && { dnaCandidates: structuredClone(result.dnaCandidates) }),
        identityContext: input.characterContext.filter((c) => keys.includes(c.characterKey))
            .map((c) => ({ characterKey: c.characterKey, dna: normalizeCharacterDna(c.dna) })),
        promptTask: structuredClone(selected.value), ...(input.slotId !== undefined && { slotId: input.slotId }) };
}
// 只在默认立绘首次采用事件中调用；返回新值，持久化成功前不替换原资料。
export function adoptSpriteIdentity(assets, name, imageId, meta, { hadDefault = false } = {}) {
    const dna = normalizeCharacterDna(assets.characterDna?.[name]);
    const binding = meta?.characters?.find((c) => c.characterKey === name);
    if (!binding || !imageId || hadDefault || dna.identityInitialized === true)
        return { characterDna: assets.characterDna || {}, characterOutfits: assets.characterOutfits || {}, wardrobe: assets.wardrobe || {} };
    const identity = [binding.identityAnchor, binding.signatureDetails].filter(Boolean).join(' ');
    const nextDna = { ...dna, identity: dna.identity || identity, identityInitialized: true, identitySource: imageId };
    const characterOutfits = { ...(assets.characterOutfits || {}) };
    const wardrobe = { ...(assets.wardrobe || {}) };
    const outfit = binding.outfit;
    if (isValidOutfitName(outfit?.name) && outfit.description) {
        const outfits = { ...(characterOutfits[name] || {}) };
        if (!Object.hasOwn(outfits, outfit.name)) {
            // 衣柜为共享字典，用角色级引用避免同名衣装覆盖。
            let wardrobeKey = `${name}·${outfit.name}`;
            let suffix = 1;
            while (Object.hasOwn(wardrobe, wardrobeKey)) wardrobeKey = `${name}·${outfit.name}·${++suffix}`;
            wardrobe[wardrobeKey] = { prompt: outfit.description };
            outfits[outfit.name] = { words: [], moods: {}, wardrobe: wardrobeKey, note: outfit.description };
            characterOutfits[name] = outfits;
        }
    }
    return { characterDna: { ...(assets.characterDna || {}), [name]: nextDna }, characterOutfits, wardrobe };
}
