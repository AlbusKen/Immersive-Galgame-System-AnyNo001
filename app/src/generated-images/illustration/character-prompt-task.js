// 人物任务交接：冻结输入资料，不展开身份、不加工模型返回的正文。
import { normalizeCharacterDna, readCharacterDnaView,
    CHARACTER_DNA_REQUIRED_VIEWS, CHARACTER_DNA_VIEWS } from '../../scene/character-dna.js';
import { moodPresetEntry, moodPresetTags } from '../../scene/mood-groups.js';
import { savedCharacterOutfits } from '../../scene/outfit-identity.js';
import { inheritImageTaskLease } from '../image-task-runtime.js';

export const usesCharacterTemplates = (backend) => ['nai', 'dbgen'].includes(backend?.describe?.().mode);

export function characterPromptTask(context, purpose, framing, slotKeys) {
    const characterContext = structuredClone(context);
    const characters = characterContext.map((c, index) => ({ characterKey: c.characterKey,
        token: `r${index.toString(36)}`, framing }));
    const byKey = new Map(characters.map((c) => [c.characterKey, c.token]));
    return { characterContext, promptTask: { version: 1, mode: 'dna_template', purpose, outfitMode: 'template', characters,
        ...(slotKeys && { slots: slotKeys.map((keys, index) => ({ slotId: index + 1,
            tokens: keys.map((key) => byKey.get(key)) })) }) } };
}

// 仅声明本轮身份字段交付要求；画面景别与候选完整性分开，不生成或改写 DNA。
export function spriteIdentityRequirements(task, context) {
    return task.characters.map(character => {
        const dna = context.find(source => source.characterKey === character.characterKey)?.dna;
        const preservedViews = CHARACTER_DNA_VIEWS.filter(view =>
            typeof dna?.views?.[view]?.subject === 'string' && dna.views[view].subject.trim());
        const complete = CHARACTER_DNA_REQUIRED_VIEWS.every(view => preservedViews.includes(view));
        const cleared = dna?.identityInitialized === true
            && !(typeof dna.identity === 'string' && dna.identity.trim()) && !preservedViews.length;
        const requiredViews = !complete && !cleared ? [...CHARACTER_DNA_REQUIRED_VIEWS] : [];
        return { characterKey: character.characterKey, token: character.token,
            ...(character.framing !== undefined && { imageFraming: character.framing }),
            mode: complete ? 'saved-only' : cleared ? 'identity-cleared' : 'candidate-required',
            requiredViews, requiredFields: requiredViews.map(view => `meta_dna_${view}`),
            preservedViews };
    });
}

export function singleCharacterContext(name, dna, outfit, assets = {}) {
    const profile = normalizeCharacterDna(dna);
    const outfits = savedCharacterOutfits(assets, name);
    // DNA 默认服装优先；旧服装库默认标记只作兼容读取，不搬移存量。
    const original = profile.defaultAppearance ? { name: '', description: profile.defaultAppearance }
        : outfits.find(o => o.default === true);
    return [{ characterKey: name, dna: profile, outfits, outfit: {
        name: String(outfit?.name || (outfit?.nude ? '裸体' : original?.name) || ''),
        description: outfit?.nude ? 'No clothing; retain the fixed identifying features.'
            : String(outfit?.prompt || (outfit?.name ? '' : original?.description || profile.defaultAppearance) || ''),
        ...(Array.isArray(outfit?.words) && { words: [...outfit.words] }),
        ...(outfit?.nsfwBoost === true && { nsfwBoost: true }),
    } }];
}

export function preflightCharacterTask(context, purpose, framing, outfit) {
    if (outfit?.form && Object.values(outfit.form).some(Boolean)) return {
        ok: false, reason: 'DNA_VIEW_INVALID', error: '当前形态尚无可核验的景别身份视图，请先补齐对应资料；基础 DNA 不会被改写',
    };
    if (purpose === 'sprite') return { ok: true };
    for (const c of context) {
        const checked = readCharacterDnaView(c.dna, framing);
        if (!checked.ok) return { ...checked, characterKey: c.characterKey };
    }
    return { ok: true };
}

// 无额外要求的预设表情：固定模板仍交唯一准备入口核验并展开双 DNA。
// 未保存衣装时不猜穿着；调用方保留同次提取衣装的写词流程。
export function savedExpressionTemplate(context, mood, prompts, { nsfw = false } = {}) {
    if (context.length !== 1 || !moodPresetEntry(mood)) return { ok: true, available: false };
    const source = context[0], outfit = source.outfit;
    const clothing = outfit?.description || source.outfits?.find(o => o.name === outfit?.name)?.description;
    if (!clothing?.trim()) return { ok: true, available: false };
    const task = characterPromptTask(context, 'derived', 'half_body', [[source.characterKey]]);
    const binding = { kind: 'named', ...task.promptTask.characters[0], captionIndex: 0 };
    const centers = [{ x: 0.5, y: 0.5 }];
    const tags = mood === '默认' || mood === '平和'
        ? 'calm, relaxed, closed mouth, natural relaxed standing pose, looking at viewer'
        : moodPresetTags(mood, { nsfw });
    const caption = {
        v4_prompt: { caption: { base_caption: prompts.positive, char_captions: [{
            char_caption: `<<dna:${binding.token}>> <<outfit:${binding.token}>> ${tags}`,
            centers,
        }] } },
        v4_negative_prompt: { caption: { base_caption: prompts.negative, char_captions: [{
            char_caption: `<<dna_uc:${binding.token}>>`,
        }] } },
    };
    return { ok: true, available: true, value: { slotId: 1, caption,
        promptRecipe: { version: 1, mode: 'dna_template', outfitMode: 'template',
            caption, bindings: [binding] },
        characterMeta: { version: 1, characters: [{ characterKey: source.characterKey,
            captionIndex: 0, outfit: { name: outfit.name, description: clothing },
            centers, positionExplicit: true }] },
        promptTask: task.promptTask,
    } };
}

// 仅复制发送所需字段；历史审计字段不能成为本次发送指令。
export function characterTemplateInput(entry, task, context) {
    const metadata = entry.characterMeta === undefined ? undefined : structuredClone(entry.characterMeta);
    // 新生成仍核对原回复；显式续画才把衣装旁路绑定到当前已保存资料。
    if (entry.rebindOutfit === true && entry.promptRecipe?.outfitMode === 'template') {
        for (const character of metadata?.characters || []) {
            const source = context.find(c => c.characterKey === character.characterKey);
            const outfit = source?.outfit;
            const saved = source?.outfits?.find(o => o.name === outfit?.name);
            if (character.outfit?.name === outfit?.name
                && (outfit?.description || saved?.description))
                character.outfit = { name: outfit.name, description: outfit.description || saved.description };
        }
    }
    return inheritImageTaskLease(entry, { caption: entry.promptRecipe?.caption || entry.caption,
        ...(entry.slotId !== undefined && { slotId: entry.slotId }),
        ...(metadata !== undefined && { characterMeta: metadata }),
        ...(entry.promptRecipe !== undefined && { promptRecipe: entry.promptRecipe }),
        ...(entry.dnaCandidates !== undefined && { dnaCandidates: entry.dnaCandidates }),
        ...(task !== undefined && { promptTask: task }), characterContext: context });
}

// 恢复资料只保存旁路，不保存当次角色上下文；下一次显式续画读取当前 DNA。
export function characterPromptRecovery(entry = {}) {
    const out = {};
    for (const key of ['promptRecipe', 'characterMeta', 'promptTask', 'dnaCandidates', 'slotId']) {
        if (entry[key] !== undefined) out[key] = structuredClone(entry[key]);
    }
    if (entry.edited === true || entry.promptEdited === true) out.edited = true;
    return out;
}
