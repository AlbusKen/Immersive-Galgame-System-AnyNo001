import { clonePromptData, validatePromptActivation } from './prompt-preset.js';

const fail = (reason) => ({ ok: false, reason });
const clean = (data) => {
    const copy = clonePromptData(data);
    delete copy.defaultState;
    return copy;
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// 基线与备份随同一个预设快照保存，绝不另写一份 current。
export function promptDefaultState(preset) {
    const copy = clonePromptData(preset);
    if (!copy.data.defaultState) copy.data.defaultState = {
        version: copy.data.defaultVersion,
        baseline: clean(copy.data), backups: [],
    };
    return copy;
}

export function stagePromptDefaultUpgrade(snapshot, preset) {
    const records = snapshot.items['prompt-preset'] || {};
    const current = records[preset.id];
    if (!current) return fail('prompt-default-not-found');
    const state = current.data.defaultState;
    if (!state || !Number.isSafeInteger(state.version) || !state.baseline
        || !Array.isArray(state.backups)) return { ok: true, changed: false, reason: 'prompt-default-baseline-unknown' };
    const version = preset.data.defaultVersion;
    if (!Number.isSafeInteger(version) || version < 1) return fail('invalid-prompt-default');
    if (version <= state.version) return { ok: true, changed: false };
    const candidate = clonePromptData(current), old = state.baseline;
    // 未修改默认正文按 ID 替换；不变更用户角色、开关、顺序或白名单。
    for (const group of ['prompts', 'modules']) {
        if (!Array.isArray(old[group])) return fail('invalid-prompt-default-baseline');
        for (const block of candidate.data[group]) {
            const previous = old[group].find(b => b.identifier === block.identifier);
            const latest = preset.data[group].find(b => b.identifier === block.identifier);
            if (previous && latest && same(block.content, previous.content)) block.content = latest.content;
        }
    }
    candidate.data.revision += 1;
    candidate.data.defaultVersion = version;
    candidate.data.defaultState = { version, baseline: clean(preset.data),
        backups: [...state.backups, { revision: current.data.revision, data: clean(current.data) }] };
    const checked = validatePromptActivation(candidate.data);
    if (!checked.ok) return { ok: false, reason: 'prompt-not-activatable', errors: checked.errors };
    const next = clonePromptData(snapshot);
    next.items['prompt-preset'][candidate.id] = candidate;
    return { ok: true, next, changed: true, item: candidate };
}

// 恢复按稳定块 ID 定位；备份版本由用户显式选择，不按数组位置猜测。
export function stagePromptDefaultRestore(snapshot, id, options = {}) {
    const current = snapshot.items['prompt-preset']?.[id];
    if (!current || current.data.revision !== options.expectedRevision)
        return fail('preset-revision-conflict');
    const state = current.data.defaultState;
    if (!state?.baseline || !Array.isArray(state.backups)) return fail('prompt-default-baseline-unknown');
    const source = options.backupRevision === undefined ? state.baseline
        : state.backups.find(backup => backup.revision === options.backupRevision)?.data;
    if (!source) return fail('prompt-default-backup-not-found');
    const group = options.group;
    if (!['prompts', 'modules'].includes(group) || typeof options.identifier !== 'string')
        return fail('invalid-prompt-restore');
    const saved = source[group]?.find(block => block.identifier === options.identifier);
    const candidate = clonePromptData(current);
    const target = candidate.data[group]?.find(block => block.identifier === options.identifier);
    if (!saved || !target || typeof saved.content !== 'string') return fail('prompt-restore-block-not-found');
    if (target.content === saved.content) return { ok: true, changed: false, item: candidate };
    target.content = saved.content;
    candidate.data.revision += 1;
    candidate.data.defaultState.backups.push({ revision: current.data.revision, data: clean(current.data) });
    const checked = validatePromptActivation(candidate.data);
    if (!checked.ok) return { ok: false, reason: 'prompt-not-activatable', errors: checked.errors };
    const next = clonePromptData(snapshot);
    next.items['prompt-preset'][id] = candidate;
    return { ok: true, next, changed: true, item: candidate };
}
