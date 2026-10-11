import { planReferenceCanvas, buildReferencePixels, composeReferencePixels } from '../../media/cg-reference-canvas.js';
import { checkCharacterMeta } from '../../schemas/character-meta.js';
import { normalizeCharacterDna } from '../../scene/character-dna.js';
import { consistencyPromptTask, checkConsistencyCaptions } from './cg-consistency-prompt.js';
import { promptProvenance, storedPromptFromResult } from '../generation-prompt.js';

const clone = (value) => JSON.parse(JSON.stringify(value));
const failure = (reason, error = '一致性重绘未保存，原图保持不变') => ({ ok: false, reason, error });
let serial = 0;

// 单任务、逐角色、内存候选。文件和目录的提交由注入的存储适配器负责。
export function createCgConsistencyService(deps) {
    const { store, nai, codec, getSceneAssets, resolveReference, targetStillLive, onAccepted } = deps;
    const now = deps.now || (() => new Date().toISOString());
    const report = (task, level, message) => {
        const floor = task?.target?.floor;
        const location = Number.isInteger(floor?.messageId) && Number.isInteger(task?.target?.slot)
            ? `第 ${floor.messageId} 楼第 ${task.target.slot} 张 ` : '';
        try { deps.report?.(level, `${location}角色一致性重绘 [${task.id}] ${message}`); } catch { /* 日志失败不影响任务 */ }
    };
    const reasonCodes = new Set(['DNA_TEMPLATE_BINDING', 'DNA_TEMPLATE_UNRESOLVED', 'DNA_MISSING',
        'DNA_VIEW_MISSING', 'PROMPT_MODE_CONFLICT', 'consistency-write-failed', 'consistency-busy',
        'consistency-unavailable', 'consistency-failed', 'dbgen-infill-required', 'no-canvas',
        'cg-binding-incomplete', 'cg-image-missing', 'cg-reference-missing', 'cg-size-mismatch',
        'cg-position-ambiguous', 'generation-config-unavailable', 'GENERATION_CONFIG_CHANGED',
        'stale-target', 'stale-revision', 'stale-dna', 'stale-config', 'cancelled', 'edit-failed',
        'slot-update-failed', 'candidate-unavailable', 'character-meta-shape', 'character-meta-caption',
        'character-meta-key', 'character-meta-binding', 'character-meta-index', 'character-meta-text',
        'character-meta-position', 'character-meta-position-mismatch', 'character-meta-region']);
    const diagnosticFields = new Set(['record.promptRecipe', 'record.characterMeta', 'reference.token',
        'dna.views', 'promptTask', 'captions.length', 'captions.slotId', 'promptRecipe.bindings.length',
        'binding.token', 'binding.kind', 'binding.characterKey', 'binding.framing', 'binding.captionIndex',
        'characterMeta', 'characterMeta.binding', 'dnaCandidates', 'promptRecipe', 'outfit.name',
        'outfit.description', 'promptTask.slotId', 'scene.caption']);
    // 外部错误正文可能含模型回复或凭据；日志只接受受控码、字段路径和数值索引。
    const reportFailure = (task, result) => {
        const reason = reasonCodes.has(result?.reason) ? result.reason : 'consistency-failed';
        const d = result?.diagnostics;
        const details = [Number.isInteger(task.roundId) ? `slotid ${task.roundId}` : '',
            diagnosticFields.has(d?.field) ? d.field : '',
            Number.isInteger(d?.slotId) ? `slotid ${d.slotId}` : '',
            Number.isInteger(d?.captionIndex) ? `Char ${d.captionIndex}` : '',
            Number.isInteger(d?.expectedCount) && Number.isInteger(d?.actualCount)
                ? `预期 ${d.expectedCount} 份，实际 ${d.actualCount} 份` : ''].filter(Boolean).join('；');
        report(task, reason === 'cancelled' ? 'info' : 'error',
            `阶段 ${task.phase || 'prepare'}；${reason}${details ? `；${details}` : ''}；原图保持不变`);
    };
    let active = null;
    const live = (task) => active === task && !task.controller.signal.aborted
        && targetStillLive(task.target.floor, task.target.slot)
        && (!task.options.shouldStart || task.options.shouldStart());
    const guard = (task) => { if (!live(task)) throw new Error('stale-target'); };
    const dnaUnchanged = (task) => !task.bundle || task.bundle.characterContext.every((c) =>
        JSON.stringify(normalizeCharacterDna(getSceneAssets()?.characterDna?.[c.characterKey]))
            === JSON.stringify(c.dna));
    const requirementsUnchanged = (task) => !deps.writingRequirements
        || JSON.stringify(deps.writingRequirements()) === JSON.stringify(task.writingRequirements);
    const canStart = (task) => live(task) && dnaUnchanged(task) && requirementsUnchanged(task);
    const configCurrent = (task) => task.configIsCurrent?.() === true;
    const unchanged = async (task) => {
        guard(task);
        const record = await store.getSlotRecord(task.record.key);
        guard(task);
        if (!record || (record.revision || 0) !== (task.record.revision || 0)
            || record.revisionToken !== task.record.revisionToken) throw new Error('stale-revision');
        if (!dnaUnchanged(task)) throw new Error('stale-dna');
        if (!requirementsUnchanged(task)) throw new Error('stale-config');
        const config = await wait(task, nai.getEditConfig({ imageKind: 'cg', promptKind: 'cg' }));
        guard(task);
        if (!config?.ok || config.configToken !== task.editConfig.configToken
            || JSON.stringify(config.artist) !== JSON.stringify(task.editConfig.artist)
            || !configCurrent(task))
            throw new Error('stale-config');
        if (!dnaUnchanged(task)) throw new Error('stale-dna');
        if (!requirementsUnchanged(task)) throw new Error('stale-config');
    };
    const capability = () => {
        const cap = nai?.describeEdit?.();
        if (!cap?.supported || cap.via !== 'dbgen') return failure(cap?.reason || 'dbgen-infill-required', cap?.message || '请启用支持 V5 局部重绘的数据库生图插件');
        if (!codec?.available) return failure('no-canvas', '当前环境不支持图片画布');
        if (typeof store.updateSlot !== 'function' || typeof resolveReference !== 'function'
            || typeof nai.writeDbgenPrompt !== 'function' || typeof nai.getEditConfig !== 'function')
            return failure('consistency-unavailable');
        return { ok: true };
    };

    async function prepare(task) {
        const cap = capability();
        if (!cap.ok) return cap;
        guard(task);
        const record = await store.getSlotRecord(`${task.target.key}|${task.target.slot}`);
        guard(task);
        if (!record?.dataUrl || record.status !== 'done') return failure('cg-image-missing', '当前 CG 尚未保存可用图片');
        const assets = clone(getSceneAssets());
        const checked = checkCharacterMeta(record.characterMeta, record.caption, Object.keys({ ...assets.characters, ...assets.generated?.characters, ...assets.characterDna }));
        const chars = checked.value?.characters;
        if (!checked.ok) return checked;
        if (!chars?.length || chars.length !== record.caption?.v4_prompt?.caption?.char_captions?.length) return failure('cg-binding-incomplete', '旧 CG 或角色绑定不完整，不能猜测人物身份');
        task.record = record;
        task.assets = assets;
        task.characters = chars.slice().sort((a, b) => a.captionIndex - b.captionIndex);
        if (deps.writingRequirements) task.writingRequirements = clone(deps.writingRequirements());
        const config = await wait(task, nai.getEditConfig({ imageKind: 'cg', promptKind: 'cg' }));
        guard(task);
        if (!config?.ok) return config || failure('generation-config-unavailable');
        if (typeof config.isCurrent !== 'function' || config.isCurrent() !== true)
            return failure('generation-config-unavailable');
        task.configIsCurrent = config.isCurrent;
        task.editConfig = { version: config.version, configToken: config.configToken, artist: clone(config.artist) };
        await unchanged(task);
        return { ok: true };
    }

    async function writeTemplates(task) {
        task.phase = 'binding';
        const bundle = consistencyPromptTask(task.record, task.characters, task.assets, task.plans);
        if (!bundle.ok) return bundle;
        task.bundle = bundle;
        await unchanged(task);
        task.phase = 'write';
        report(task, 'info', `开始一次批量写词：${bundle.expected.length} 份模板`);
        const written = await wait(task, nai.writeDbgenPrompt({ description: bundle.description,
            promptTask: bundle.promptTask, characterContext: bundle.characterContext,
            ...(task.writingRequirements && { writingRequirements: clone(task.writingRequirements) }),
            signal: task.controller.signal, shouldStart: () => canStart(task) }));
        await unchanged(task);
        task.phase = 'binding';
        const checked = checkConsistencyCaptions(written, bundle, task.characters);
        if (!checked.ok) return checked;
        task.scene = checked.scene;
        task.rounds = checked.rounds;
        task.audit = [];
        return { ok: true };
    }

    const wait = (task, promise) => new Promise((resolve, reject) => {
        const signal = task.controller.signal;
        const abort = () => { cleanup(); reject(new Error('cancelled')); };
        const cleanup = () => signal.removeEventListener('abort', abort);
        if (signal.aborted) { abort(); return; }
        signal.addEventListener('abort', abort, { once: true });
        Promise.resolve(promise).then((value) => { cleanup(); resolve(value); }, (error) => { cleanup(); reject(error); });
    });
    function release(task) {
        task.detach?.();
        task.references = null;
        task.pixels = null;
        task.dataUrl = '';
        if (active === task) active = null;
    }
    async function generate(task) {
        try {
            const prepared = await prepare(task);
            if (!prepared.ok) return prepared;
            task.phase = 'reference';
            const hydrated = store.hydrateSlot ? await wait(task, store.hydrateSlot(task.record)) : task.record;
            let pixels = await wait(task, codec.decodeImage(hydrated.dataUrl, { signal: task.controller.signal }));
            guard(task);
            const size = task.record.originalSize;
            if (size && (size.width !== pixels.width || size.height !== pixels.height)) throw new Error('cg-size-mismatch');
            task.plans = task.characters.map((c) => planReferenceCanvas(pixels.width, pixels.height,
                { characters: task.characters }, c.characterKey));
            const invalid = task.plans.find((p) => !p.ok);
            if (invalid) return invalid;
            task.references = [];
            // 先载入全部已保存参考，缺一张也不发送部分角色请求。
            for (const binding of task.characters) {
                const src = await wait(task, resolveReference(binding.characterKey, task.assets));
                guard(task);
                if (!src) return failure('cg-reference-missing', `角色「${binding.characterKey}」没有可读取的已保存默认立绘`);
                task.references.push(await wait(task, codec.decodeImage(src, { signal: task.controller.signal })));
            }
            const templates = await writeTemplates(task);
            if (!templates.ok) return templates;
            for (let i = 0; i < task.characters.length; i++) {
                await unchanged(task);
                const binding = task.characters[i], plan = task.plans[i];
                task.phase = 'edit';
                task.roundId = task.rounds[i].slotId;
                report(task, 'info', `开始局部重绘 ${i + 1}/${task.characters.length}；slotid ${task.roundId}`);
                task.options.onProgress?.({ phase: 'consistency', done: i, total: task.characters.length, characterKey: binding.characterKey });
                const work = buildReferencePixels(pixels, task.references[i], plan);
                const sourceDataUrl = await wait(task, codec.encodePixels(work.image));
                const maskDataUrl = await wait(task, codec.encodePixels(work.mask));
                await unchanged(task);
                const result = await wait(task, nai.edit({ ...task.rounds[i], sourceDataUrl, maskDataUrl,
                    width: plan.size.width, height: plan.size.height, strength: 0.35, imageKind: 'cg', promptKind: 'cg',
                    artist: task.editConfig.artist, expectedConfigToken: task.editConfig.configToken,
                    signal: task.controller.signal, shouldStart: () => canStart(task) }));
                await unchanged(task);
                if (!result?.ok || !result.dataUrl) return failure(result?.reason || 'edit-failed', result?.error);
                if (!result.promptRecipe || !result.dnaSnapshot || !result.sentPrompt)
                    return failure('PROMPT_MODE_CONFLICT', '重绘结果缺少实际发送来源，原图保持不变');
                task.audit.push({ slotId: task.rounds[i].slotId, characterKey: binding.characterKey,
                    ...promptProvenance(result) });
                const generated = await wait(task, codec.decodeImage(result.dataUrl, { signal: task.controller.signal }));
                guard(task);
                pixels = composeReferencePixels(pixels, generated, plan);
            }
            task.phase = 'compose';
            delete task.roundId;
            task.dataUrl = await wait(task, codec.encodePixels(pixels));
            await unchanged(task);
            task.state = 'candidate';
            report(task, 'info', '候选已生成，尚未保存；请在预览中接受或取消');
            return { ok: true, reason: 'candidate', candidateId: task.id, dataUrl: task.dataUrl,
                width: pixels.width, height: pixels.height };
        } catch (error) {
            return failure(task.controller.signal.aborted ? 'cancelled' : (error?.message || 'consistency-failed'));
        } finally {
            task.options.onProgress?.({ phase: 'done' });
            task.references = null;
            if (task.state !== 'candidate') release(task);
        }
    }

    function run(target, options = {}) {
        if (active) return Promise.resolve(failure('consistency-busy', '已有一致性任务或候选，请先停止或取消'));
        const task = { id: `cg-consistency-${++serial}`, target, options, controller: new AbortController(), state: 'running', phase: 'prepare' };
        active = task;
        const abort = () => cancel(task.id);
        options.signal?.addEventListener('abort', abort, { once: true });
        task.detach = () => options.signal?.removeEventListener('abort', abort);
        if (options.signal?.aborted) task.controller.abort();
        report(task, 'info', '开始准备，原 CG 保持不变');
        return generate(task).then((result) => {
            if (!result.ok) reportFailure(task, result);
            return result;
        });
    }
    async function accept(candidateId) {
        const task = active;
        if (!task || task.id !== candidateId || task.state !== 'candidate') return failure('candidate-unavailable');
        task.state = 'accepting';
        task.phase = 'commit';
        report(task, 'info', '开始接受候选，正在复核提交条件');
        try {
            await unchanged(task);
            const result = await store.updateSlot(task.target.key, task.target.slot, task.record.revision || 0,
                { dataUrl: task.dataUrl, caption: task.scene.caption, characterMeta: task.scene.characterMeta,
                    ...promptProvenance(task.scene), prompt: storedPromptFromResult(task.scene),
                    characterContext: task.bundle.characterContext,
                    promptTask: { version: 1, mode: 'dna_template', purpose: 'cg',
                        characters: task.scene.promptRecipe.bindings.map(({ kind, characterKey, token, framing }) =>
                            ({ kind, characterKey, token, framing })) },
                    // 正式场景未作为整图发送，不能伪造它的 wire；实际 infill 来源单独归档。
                    ...promptProvenance({ consistencyPrompt: { version: 1, rounds: task.audit } }),
                    promptEdited: false, preflightFailure: null, error: null, failureReason: null,
                    status: 'done', updatedAt: now() },
                { expectedToken: task.record.revisionToken, preserveBaseline: true, clearSentPrompt: true,
                    beforeCommit: () => unchanged(task),
                    shouldCommit: () => canStart(task) && configCurrent(task) });
            if (!result?.ok) {
                const rejected = failure(!dnaUnchanged(task) ? 'stale-dna'
                : !requirementsUnchanged(task) || !configCurrent(task) ? 'stale-config'
                : result?.reason || 'slot-update-failed');
                reportFailure(task, rejected);
                return rejected;
            }
            let warning = result.warning;
            try { onAccepted?.(task.target, result.record); } catch { warning ||= 'cg-display-sync-failed'; }
            report(task, warning ? 'warn' : 'success', `已接受并保存${warning ? '；目录或显示同步需刷新复查' : ''}`);
            return { ok: true, reason: 'accepted', ...(warning && { warning }) };
        } catch (error) {
            const rejected = failure(['stale-target', 'stale-revision', 'stale-dna', 'stale-config'].includes(error?.message) ? error.message : 'slot-update-failed',
                '保存失败或目标已变化，未接受候选；请重新读取当前 CG');
            reportFailure(task, rejected);
            return rejected;
        }
        finally { release(task); }
    }
    function cancel(candidateId) {
        const task = active;
        if (!task || (candidateId && task.id !== candidateId)) return { ok: true, reason: 'no-task' };
        report(task, 'info', '已请求停止或取消；未接受的候选将丢弃，上游已发请求可能仍在执行');
        task.controller.abort();
        if (task.state !== 'accepting') release(task);
        return { ok: true, reason: 'cancelled' };
    }
    return { run, accept, cancel, capability, isBusy: () => Boolean(active) };
}
