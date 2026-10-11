// 人物任务交接：冻结输入资料，不展开身份、不加工模型返回的正文。
import { normalizeCharacterDna, readCharacterDnaView } from '../../scene/character-dna.js';

export const usesCharacterTemplates = (backend) => ['nai', 'dbgen'].includes(backend?.describe?.().mode);

export function characterPromptTask(context, purpose, framing, slotKeys) {
    const characterContext = structuredClone(context);
    const characters = characterContext.map((c, index) => ({ characterKey: c.characterKey,
        token: `r${index.toString(36)}`, framing }));
    const byKey = new Map(characters.map((c) => [c.characterKey, c.token]));
    return { characterContext, promptTask: { version: 1, mode: 'dna_template', purpose, characters,
        ...(slotKeys && { slots: slotKeys.map((keys, index) => ({ slotId: index + 1,
            tokens: keys.map((key) => byKey.get(key)) })) }) } };
}

export function singleCharacterContext(name, dna, outfit) {
    const profile = normalizeCharacterDna(dna);
    return [{ characterKey: name, dna: profile, outfit: {
        name: String(outfit?.name || ''),
        description: outfit?.nude ? 'No clothing; retain the fixed identifying features.'
            : String(outfit?.prompt || (outfit?.name ? '' : profile.defaultAppearance) || ''),
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

// 仅复制发送所需字段；历史审计字段不能成为本次发送指令。
export function characterTemplateInput(entry, task, context) {
    return { caption: entry.promptRecipe?.caption || entry.caption,
        ...(entry.slotId !== undefined && { slotId: entry.slotId }),
        ...(entry.characterMeta !== undefined && { characterMeta: entry.characterMeta }),
        ...(entry.promptRecipe !== undefined && { promptRecipe: entry.promptRecipe }),
        ...(entry.dnaCandidates !== undefined && { dnaCandidates: entry.dnaCandidates }),
        ...(task !== undefined && { promptTask: task }), characterContext: context };
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
