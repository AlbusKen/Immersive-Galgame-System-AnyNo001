// 唯一身份展开点：无存储、模型或配置访问；调用方提供本次资料快照。
import { checkPromptRecipe, checkPromptTask, checkPromptOutput, checkRecipeCharacterMeta, promptTaskForSlot, isSceneOnlyPromptOutput } from '../schemas/prompt-recipe.js';
import { readCharacterDnaView, normalizeCharacterDna, checkDnaViews } from '../scene/character-dna.js';
import { checkOutfitTemplates } from '../schemas/outfit-template.js';
const fail = (reason, error) => ({ ok: false, reason, error });
const controlled = /<<\s*(?:dna|outfit)/i;
const textFields = (caption) => [caption?.v4_prompt?.caption, caption?.v4_negative_prompt?.caption]
    .flatMap((side) => [side?.base_caption, ...(side?.char_captions || []).map((c) => c.char_caption)]);
function freeze(value) {
    if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
    return value;
}

// 普通 CG 可消费本次写词的身份旁路；不补建 DNA，也不替换身份错绑或非法资料。
export function readCaptionIdentity(dna, framing, purpose, metadata) {
    const saved = readCharacterDnaView(dna, framing);
    if (saved.ok) return { ...saved, source: 'saved' };
    if (purpose !== 'cg' || !['DNA_MISSING', 'DNA_VIEW_MISSING'].includes(saved.reason)) return saved;
    if (dna?.version !== undefined && dna.version !== 2)
        return fail('DNA_VIEW_INVALID', '未知 DNA 版本不能作为当次身份降级');
    if (dna?.version === 2 && dna.views !== undefined && !checkDnaViews(dna.views, { allowEmpty: true }).ok)
        return fail('DNA_VIEW_INVALID', '非法景别资料不能作为当次身份降级');
    const subject = metadata?.identityAnchor, signature = metadata?.signatureDetails || '';
    if (typeof subject !== 'string' || !subject.trim() || subject.length > 4096
        || typeof signature !== 'string' || signature.length > 4096) return saved;
    if (controlled.test(subject + signature))
        return fail('DNA_TEMPLATE_UNRESOLVED', '当次身份描述不能包含身份令牌');
    // 旁路由写词模型按实际取景给出完整主语；程序不裁切、拼补或重新设计身份。
    return { ok: true, source: 'scene', value: { subject: subject.trim(), negative: '' } };
}

export function prepareCharacterCaption(input = {}) {
    const { caption, promptRecipe, characterContext = [], dnaCandidates, promptTask } = input;
    if (!caption) return fail('DNA_TEMPLATE_BINDING', '缺少人物提示词');
    if (input.captionMode !== undefined && input.captionMode !== 'final')
        return fail('PROMPT_MODE_CONFLICT', '未知提示词发送模式');
    if (input.captionMode === 'final' && (promptRecipe !== undefined || promptTask !== undefined || dnaCandidates !== undefined))
        return fail('PROMPT_MODE_CONFLICT', '手改定稿不能同时应用身份模板或候选');
    if (promptTask?.purpose === 'cg' && isSceneOnlyPromptOutput(input)) {
        const task = checkPromptTask(promptTask, characterContext);
        if (!task.ok) return task;
        return { ok: true, caption: structuredClone(caption) };
    }
    if (promptRecipe === undefined && (promptTask !== undefined || dnaCandidates !== undefined))
        return fail('PROMPT_MODE_CONFLICT', '新模板任务缺少动态模板，已停止出图');
    if (input.captionMode === 'final' || promptRecipe === undefined) {
        if (textFields(caption).some((v) => controlled.test(v || '')))
            return fail('DNA_TEMPLATE_UNRESOLVED', '定稿或旧提示词不能包含未展开的身份令牌');
        return { ok: true, caption: structuredClone(caption), ...(input.captionMode && { captionMode: 'final' }) };
    }
    const validTask = checkPromptTask(promptTask, characterContext);
    if (!validTask.ok) return validTask;
    const selected = promptTaskForSlot(validTask.value, input.slotId);
    if (!selected.ok) return selected;
    const checked = checkPromptRecipe(promptRecipe, caption, selected.value);
    if (!checked.ok) return checked;
    if (!Array.isArray(characterContext)) return fail('DNA_TEMPLATE_BINDING', '缺少角色资料快照');
    // 已保存的显式 recipe 可独立重画；候选与 reference 必须保留原任务用途，不能猜测。
    if (!validTask.value && (dnaCandidates !== undefined || checked.value.bindings.some((b) => b.kind === 'reference')))
        return fail('PROMPT_MODE_CONFLICT', '身份候选或参考角色缺少显式任务');
    const output = validTask.value
        ? checkPromptOutput({ caption, promptRecipe, dnaCandidates, characterMeta: input.characterMeta }, selected.value, characterContext)
        : checkRecipeCharacterMeta(checked.value, input.characterMeta);
    if (!output.ok) return output;
    const outfits = checkOutfitTemplates(checked.value, input.characterMeta, characterContext, selected.value);
    if (!outfits.ok) return outfits;
    for (const b of checked.value.bindings.filter((b) => b.token)) {
        if (characterContext.filter((c) => c?.characterKey === b.characterKey).length !== 1)
            return fail('DNA_TEMPLATE_BINDING', '角色资料快照无法唯一绑定');
    }
    const expanded = structuredClone(caption), characters = [];
    for (const b of checked.value.bindings) {
        if (!b.token) continue;
        const saved = characterContext.find((c) => c.characterKey === b.characterKey)?.dna;
        const candidate = output.value.dnaCandidates?.characters.find((c) => c.characterKey === b.characterKey);
        const dna = candidate ? { ...normalizeCharacterDna(saved), version: 2, views: candidate.views } : saved;
        const metadata = input.characterMeta?.characters?.find((c) => c.characterKey === b.characterKey && c.captionIndex === b.captionIndex);
        const view = readCaptionIdentity(dna, b.framing, selected.value?.purpose, metadata);
        if (!view.ok) return { ...view, characterKey: b.characterKey, framing: b.framing };

        if (controlled.test(view.value.subject) || controlled.test(view.value.negative))
            return fail('DNA_TEMPLATE_UNRESOLVED', '身份资料不能包含递归令牌');
        const pos = expanded.v4_prompt.caption.char_captions[b.captionIndex];
        const neg = expanded.v4_negative_prompt.caption.char_captions[b.captionIndex];
        // 替换回调保真 $、权重与标点；只替换原模板，不再扫描替换产物。
        pos.char_caption = pos.char_caption.replace(`<<dna:${b.token}>>`, () => view.value.subject);
        const outfit = outfits.value.characters.find(c => c.captionIndex === b.captionIndex);
        if (outfit) pos.char_caption = pos.char_caption.replace(`<<outfit:${b.token}>>`, () => outfit.description);
        if (neg) neg.char_caption = neg.char_caption.replace(`<<dna_uc:${b.token}>>`, () => view.value.negative);
        characters.push({ ...b, source: candidate ? 'candidate' : view.source,
            dnaVersion: view.source === 'scene' ? 0 : 2,
            subject: view.value.subject, negative: view.value.negative,
            profile: normalizeCharacterDna(dna) });
    }
    if (textFields(expanded).some((v) => controlled.test(v || '')))
        return fail('DNA_TEMPLATE_UNRESOLVED', '身份展开后仍有未解析令牌');
    return freeze({ ok: true, caption: expanded, captionMode: 'final', promptRecipe: checked.value,
        dnaSnapshot: { version: 1, characters },
        ...(checked.value.outfitMode === 'template' && { outfitSnapshot: outfits.value,
            ...(input.characterMeta && { characterMeta: { ...structuredClone(input.characterMeta), characters: input.characterMeta.characters.map(c => {
                const outfit = outfits.value.characters.find(o => o.captionIndex === c.captionIndex);
                return outfit ? { ...structuredClone(c), outfit: { name: outfit.name, description: outfit.description } } : structuredClone(c);
            }) } }) }),
        ...(output.value.dnaCandidates !== undefined && { dnaCandidates: output.value.dnaCandidates }) });
}
