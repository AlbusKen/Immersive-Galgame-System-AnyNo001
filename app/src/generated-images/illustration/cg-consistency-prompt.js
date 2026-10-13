import { readCharacterDnaView } from '../../scene/character-dna.js';
import { currentCgContext } from './cg-character-bindings.js';
import { checkPromptTask, checkPromptOutput, checkPromptRecipe, promptTaskForSlot } from '../../schemas/prompt-recipe.js';
import { checkCharacterMeta } from '../../schemas/character-meta.js';
import { prepareCharacterCaption } from '../character-caption.js';

// 诊断只带字段路径和数值索引，不包含衣装正文、身份资料或写词回复。
const fail = (reason = 'DNA_TEMPLATE_BINDING', field = 'promptRecipe', where = {}) => ({
    ok: false, reason, diagnostics: { phase: 'binding', field, ...where },
    error: `一致性绑定校验失败：${where.slotId !== undefined ? `slotid ${where.slotId} ` : ''}`
        + `${where.captionIndex !== undefined ? `Char ${where.captionIndex} ` : ''}${field} 不符合本次任务；原图保持不变`,
});
const checkedFailure = (result, field, where = {}) => ({ ...result,
    ...fail(result.reason || 'DNA_TEMPLATE_BINDING', field, where) });
const whereOf = (slotId, captionIndex) => ({ slotId,
    ...(Number.isInteger(captionIndex) && { captionIndex }) });

// 只计算角色选择和坐标；各 slot 的参考说明及语义正文由独立写词请求生成。
export function consistencyPromptTask(record, characters, assets, plans) {
    const recipe = record.promptRecipe;
    if (!checkPromptRecipe(recipe, recipe?.caption).ok || !recipe
        || recipe.bindings.length !== characters.length
        || recipe.bindings.some((b) => b.kind !== 'named')) return fail('cg-binding-incomplete', 'record.promptRecipe');
    const context = currentCgContext(record, assets);
    const named = characters.map((c) => recipe.bindings.find((b) =>
        b.characterKey === c.characterKey && b.captionIndex === c.captionIndex));
    if (named.some((b) => !b)) return fail('DNA_TEMPLATE_BINDING', 'record.characterMeta');
    const refs = named.map((b, i) => ({ characterKey: b.characterKey, token: `ref${i.toString(36)}`,
        kind: 'reference', framing: 'portrait' }));
    if (refs.some((r) => named.some((b) => b.token === r.token))) return fail('DNA_TEMPLATE_BINDING', 'reference.token');
    for (const b of [...named, ...refs]) {
        const view = readCharacterDnaView(context.find((c) => c.characterKey === b.characterKey)?.dna, b.framing);
        if (!view.ok) return checkedFailure(view, 'dna.views');
    }
    const scene = { slotId: 1, rows: named.map((b) => ({ ...b,
        centers: record.caption.v4_prompt.caption.char_captions[b.captionIndex].centers })) };
    const rounds = plans.map((plan, i) => ({ slotId: i + 2, characterKey: characters[i].characterKey,
        size: plan.size, rows: named.flatMap((b) => {
            const centers = scene.rows.find((r) => r.token === b.token).centers.filter((p) =>
                p.x * plan.width >= plan.crop.x && p.x * plan.width < plan.crop.right
                && p.y * plan.height >= plan.crop.y && p.y * plan.height < plan.crop.bottom).map((p) => ({
                x: (p.x * plan.width - plan.crop.x) * plan.work.width / plan.crop.width / plan.size.width,
                y: (p.y * plan.height - plan.crop.y) * plan.work.height / plan.crop.height / plan.size.height }));
            return centers.length ? [{ ...b, centers }] : [];
        }).concat({ ...refs[i], centers: [{ x: (plan.reference.x + plan.reference.width / 2) / plan.size.width,
            y: (plan.reference.y + plan.reference.height / 2) / plan.size.height }] }) }));

    const expected = [scene, ...rounds];
    const promptTask = { version: 1, mode: 'dna_template', purpose: 'consistency',
        ...(recipe.outfitMode && { outfitMode: recipe.outfitMode }),
        characters: [...named, ...refs].map(({ kind, characterKey, token, framing }) =>
            ({ kind, characterKey, token, framing })),
        slots: expected.map((s) => ({ slotId: s.slotId, tokens: s.rows.map((r) => r.token) })) };
    const checked = checkPromptTask(promptTask, context);
    if (!checked.ok) return checkedFailure(checked, 'promptTask');
    return { ok: true, promptTask: checked.value, characterContext: context, expected,
        description: [
            '为当前 CG 一致性重绘写出本次 promptTask.slots 指定的动态模板；其他 slot 由独立请求完成，不重复输出。不得看图定位，不生成 DNA，不新增人物。',
            '允许修改的唯一范围：该轮 characterKey 对应目标的稳定身份特征，仅对照其已保存 DNA 中明确强调且参照图支持的外貌和标志细节校正；DNA 是身份权威，参照图只辅助匹配。未知、矛盾或画外特征不猜测，不为追求相似度重新设计人物。',
            '身份校正限于有依据的脸型与五官、发色发型、瞳色、肤色、角、尾巴、翅膀、非人耳及标志饰品等；逐项核对保存 DNA 与原图可见依据，不能只顾五官而遗漏关键非人特征或饰品，也不能把它们当衣装随换装删除。不强行补出画外或被遮挡的尾翼、不改变其姿态、位置或接触关系。不把参照图的服装、姿态、表情、视线方向、背景、光照或画风迁移到 CG。只校正不一致之处，已经一致的特征保持。',
            '保姿优先于身份相似度：即使 DNA 描述了体型、身高或身体比例，也不得据此重塑原 CG 的身体轮廓、骨架、肢体长度或躯干比例，不移动头部、手脚和接触点，不改变人物占画面的大小。身份细节与原姿势、遮挡或接触关系冲突时保留原 CG，不追求立绘姿态。',
            '其他内容全部保持原 CG：衣装颜色、款式、材质与配件，表情、视线、姿势、动作、身体朝向、位置、尺度、遮挡、互动和接触关系；其他人物、马匹等动物的毛色与外形、道具、缰绳、建筑、背景、构图、镜头、光影、画风和整体色调不得改变。衣装配件仅在 DNA 明确列为身份标志且原 CG 可见时校正该标志，不改整套衣服。',
            'slotid 1 是原尺寸正式场景模板：保留原 CG 全部动态和非身份内容，不含辅助图或额外参考人物。其余 slotid 是工作轮次：只校正该轮目标身份，裁剪区中的非目标人物和物件也必须保留，不把粗区域等同于整块重设计许可。',
            '每个工作轮次独立用于实际重绘，不会继承 slotid 1 的正文。必须在每份工作 Scene 与对应目标 Char 中具体保留原场景依据已有的姿势、动作、身体朝向、表情、视线、遮挡和互动接触关系；不得省略为仅身份与衣装，也不得只写笼统的保持原姿势。原依据未描述的细节不猜测，沿用输入 CG；不把裁剪或参考图当成新的镜头与构图。',
            '具名人物的 meta_outfit_name 与 meta_outfit_description 必须从本次角色资料的 outfit.name/description 逐字照抄；这些字段来自原 CG 衣装快照，不是参照立绘衣装。不改写、不翻译、不补全，空值保持为空。实际 Char 绘图正文必须同时保持该原衣装的颜色和细节；元数据照抄但正文换色同样不合格。',
            ...(recipe.outfitMode === 'template' ? ['每份写 outfit_mode: template；named Char 恰写本人的 <<outfit:token>> 一次，不另写衣装说明。reference 与所有 UC 不使用衣装占位。原 CG 衣装仅按快照展开，不采用新候选或参照图服装。'] : []),
            '以本次输出清单的 captionIndex 作为本图 Char 的零基索引，从 0 连续编号。slotid、原图角色序号和 token 中的数字都不是本图索引。同一 characterKey 的 named 与 reference 是两个独立 Char，必须各用清单给出的索引和 token，不能合并。每个索引的每个 meta_* 字段恰好写一次，不在图末重复汇总。',
            '工作画布侧边辅助图仅供识别目标身份，不是剧情里的第二个人、肖像画或装饰。工作模板 Scene 只描述原 CG 的连续场景与互动；不得把 reference inset、panel、frame、border、split screen、collage、左右分栏、画布边缘、矩形蒙版或参考布局写成正向画面内容，包括不要在正向正文写 no frame 一类否定句。',
            '参考 Char 仍使用输入的独立 reference token 和 portrait 景别，只引用身份主语及简洁可见状态，不要求相框、描边、展示卡、衣装或新背景。协议字段仍完整：在参考 Char 自己的索引各写一次 meta_outfit_name: 索引 | 和 meta_outfit_description: 索引 |，值均为空；不得复制 named 的衣装或写回 named 的索引。正式场景不含 reference Char。',
            '将新增相框、金色边框、装饰边线、分栏、拼贴及重复参考人物等伪影排除项写入工作轮次 scene_uc，而不是正向 Scene；保留原 CG 中实际存在的物件，不把真实建筑或道具误当技术边界删除。',
            '每份严格绑定该 slots 的全部 token；景别照抄输入。所有动态文字、质量、UC 在本次完成，不输出画师串。',
            '原场景与互动依据（旧完整词只作语义依据，不复制旧身份）：\n' + JSON.stringify(record.promptEdited ? record.caption : recipe.caption),
        ].join('\n') };
}

// 返回顺序不代表轮次；按 slotId/token 对账后仅装配几何字段。
export function checkConsistencyCaptions(written, bundle, characters) {
    if (!written?.ok) return written || fail('consistency-write-failed');
    const entries = written.captions;
    if (!Array.isArray(entries) || entries.length !== bundle.expected.length)
        return fail('DNA_TEMPLATE_BINDING', 'captions.length', {
            expectedCount: bundle.expected.length, actualCount: Array.isArray(entries) ? entries.length : 0 });
    const ids = entries.map((e) => e?.slotId);
    if (new Set(ids).size !== ids.length || bundle.expected.some((e) => !ids.includes(e.slotId)))
        return fail('DNA_TEMPLATE_BINDING', 'captions.slotId');
    const results = [];
    for (const expected of bundle.expected) {
        const entry = entries.find((e) => e.slotId === expected.slotId);
        const bindings = entry.promptRecipe?.bindings;
        if (!Array.isArray(bindings) || bindings.length !== expected.rows.length)
            return fail('DNA_TEMPLATE_BINDING', 'promptRecipe.bindings.length', whereOf(expected.slotId));
        for (const binding of bindings) {
            const where = whereOf(expected.slotId, binding?.captionIndex);
            const row = expected.rows.find((r) => r.token === binding?.token);
            if (!row) return fail('DNA_TEMPLATE_BINDING', 'binding.token', where);
            for (const field of ['kind', 'characterKey', 'framing']) {
                if (row[field] !== binding[field]) return fail('DNA_TEMPLATE_BINDING', `binding.${field}`, where);
            }
        }
        const meta = checkCharacterMeta(entry.characterMeta, entry.caption,
            bundle.characterContext.map((c) => c.characterKey));
        if (!meta.ok) return checkedFailure(meta, 'characterMeta', whereOf(expected.slotId));
        const output = checkPromptOutput({ ...entry, characterMeta: meta.value },
            bundle.promptTask, bundle.characterContext);
        if (!output.ok) return checkedFailure(output, entry.dnaCandidates !== undefined ? 'dnaCandidates' : 'promptRecipe', whereOf(expected.slotId));
        const recipe = output.value.promptRecipe;

        const caption = structuredClone(entry.caption);
        const metadata = [];
        for (const binding of recipe.bindings) {
            const row = expected.rows.find((r) => r.token === binding.token);
            const where = whereOf(expected.slotId, binding.captionIndex);
            const original = characters.find((c) => c.characterKey === binding.characterKey);
            if (binding.kind === 'named') {
                const returned = meta.value.characters.find((c) => c.captionIndex === binding.captionIndex);
                if (!original || !returned) return fail('DNA_TEMPLATE_BINDING', 'characterMeta.binding', where);
                for (const field of ['name', 'description']) {
                    if (returned.outfit[field] !== original.outfit[field])
                        return fail('DNA_TEMPLATE_BINDING', `outfit.${field}`, where);
                }
                if (expected.slotId === 1 && binding.captionIndex !== original.captionIndex)
                    return fail('DNA_TEMPLATE_BINDING', 'binding.captionIndex', where);
                metadata.push({ ...structuredClone(original), captionIndex: binding.captionIndex,
                    identityAnchor: '', signatureDetails: '', centers: structuredClone(row.centers),
                    positionExplicit: true });
            }
            caption.v4_prompt.caption.char_captions[binding.captionIndex].centers = structuredClone(row.centers);
        }
        if (expected.slotId !== 1) metadata.forEach((c) => { delete c.region; });
        const selected = promptTaskForSlot(bundle.promptTask, entry.slotId);
        if (!selected.ok) return checkedFailure(selected, 'promptTask.slotId', whereOf(expected.slotId));
        const input = { slotId: entry.slotId, caption,
            promptRecipe: { ...recipe, caption }, promptTask: selected.value,
            characterContext: bundle.characterContext, characterMeta: { version: 1, characters: metadata } };
        results.push(input);
    }
    const scene = prepareCharacterCaption(results[0]);
    if (!scene.ok) return checkedFailure(scene, 'scene.caption', whereOf(1));
    return { ok: true, scene: { ...scene, characterMeta: results[0].characterMeta },
        rounds: results.slice(1) };
}
