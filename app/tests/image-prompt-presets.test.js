import test from 'node:test';
import assert from 'node:assert/strict';
import { createPresetRegistry } from '../src/presets/preset-registry.js';
import { createMemoryStorage } from '../src/storage/preset-store.js';
import { createPublicApi } from '../src/api/public-api.js';

async function imagePromptPresetFixture(id = 'prompt.fixture') {
    const { IMAGE_PROMPT_TASKS } = await import('../src/presets/prompt-preset.js');
    const prompts = [
        { identifier: 'shared', role: 'system', kind: 'shared', content: '共享规则' },
        { identifier: 'task', role: 'user', kind: 'task-slot', content: '{{任务提示词}}' },
        { identifier: 'data', role: 'user', kind: 'data-slot', content: '{{任务资料}}' },
        { identifier: 'end', role: 'assistant', kind: 'shared', content: '直接输出' },
    ];
    return { format: 'igs_preset_v1', type: 'prompt-preset', id, name: id, version: 1,
        data: { schemaVersion: 1, usage: 'imagegen', revision: 1, prompts,
            prompt_order: prompts.map(({ identifier }) => ({ identifier, enabled: true })),
            variables: ['任务提示词', '任务资料'],
            modules: IMAGE_PROMPT_TASKS.map((task) => ({ identifier: `module.${task}`, task,
                role: 'user', content: `执行 ${task}`, dataFields: ['description'], requiredFields: ['description'] })),
            taskMap: Object.fromEntries(IMAGE_PROMPT_TASKS.map((task) => [task, `module.${task}`])) } };
}

test('gate:presets:prompt-import-single-write-reload-and-explicit-conflicts', async () => {
    const memory = createMemoryStorage();
    let writes = 0;
    const storage = { ...memory, setItem(key, value) { writes += 1; memory.setItem(key, value); } };
    const registry = createPresetRegistry({ storage });
    const a = await imagePromptPresetFixture('a'), b = await imagePromptPresetFixture('b');
    const preview = registry.previewPromptImport({ items: [a, b] });
    assert.equal(preview.ok, true);
    assert.equal(writes, 0);
    assert.equal(registry.commitPromptImport(preview).ok, true);
    assert.equal(writes, 1);
    assert.equal(registry.getCurrent('prompt-preset'), null);
    assert.equal(registry.setCurrent('prompt-preset', 'a').ok, true);
    const reloaded = createPresetRegistry({ storage });
    assert.deepEqual(reloaded.getCurrent('prompt-preset'), a);
    const conflict = reloaded.previewPromptImport(a), before = reloaded.snapshot();
    assert.equal(reloaded.commitPromptImport(conflict).reason, 'preset-id-conflict');
    assert.deepEqual(reloaded.snapshot(), before);
    assert.equal(reloaded.commitPromptImport(conflict, { a: 'replace' }).ok, true);
    assert.equal(reloaded.getCurrent('prompt-preset').data.revision, 2);
    assert.equal(reloaded.commitPromptImport(conflict, { a: 'replace' }).ok, true);
    assert.equal(reloaded.getCurrent('prompt-preset').data.revision, 3);
});


test('gate:presets:prompt-draft-reload-isolated-from-current-and-versioned', async () => {
    const storage = createMemoryStorage(), registry = createPresetRegistry({ storage });
    const preset = await imagePromptPresetFixture();
    assert.equal(registry.savePromptPreset(preset, null).ok, true);
    assert.equal(registry.setCurrent('prompt-preset', preset.id).ok, true);
    const draft = structuredClone(preset);
    draft.data.prompts[0].content = '草稿，不参与运行';
    draft.data.modules = [];
    assert.equal(registry.savePromptDraft(preset.id, draft, { expectedRevision: 1 }).ok, true);
    assert.deepEqual(registry.getCurrent('prompt-preset'), preset);
    const reloaded = createPresetRegistry({ storage });
    assert.deepEqual(reloaded.getPromptDraft(preset.id).preset, draft);
    assert.deepEqual(reloaded.getCurrent('prompt-preset'), preset);
    assert.equal(reloaded.savePromptDraft(preset.id, draft, { expectedRevision: 1 }).ok, true);
    assert.equal(reloaded.savePromptDraft(preset.id, draft, { expectedRevision: 1, expectedDraftRevision: 1 }).ok, true);
    assert.equal(reloaded.removePromptDraft(preset.id, 1).ok, true);
    assert.equal(createPresetRegistry({ storage }).getPromptDraft(preset.id), null);
});

test('gate:presets:prompt-write-failure-preserves-disk-memory-and-current', async () => {
    const memory = createMemoryStorage();
    let broken = false;
    const storage = { ...memory, setItem(key, value) {
        if (broken) throw new Error('fake quota');
        memory.setItem(key, value);
    } };
    const registry = createPresetRegistry({ storage }), preset = await imagePromptPresetFixture();
    assert.equal(registry.savePromptPreset(preset, null).ok, true);
    assert.equal(registry.setCurrent('prompt-preset', preset.id).ok, true);
    const preview = registry.previewPromptImport({ items: [await imagePromptPresetFixture('a'), await imagePromptPresetFixture('b')] });
    const before = registry.snapshot(), disk = memory.dump();
    broken = true;
    assert.equal(registry.commitPromptImport(preview).reason, 'preset-store-write-failed');
    assert.deepEqual(registry.snapshot(), before);
    assert.deepEqual(memory.dump(), disk);
    assert.equal(registry.savePromptPreset(preset, 1).reason, 'preset-store-write-failed');
    assert.equal(registry.savePromptDraft(preset.id, preset, { expectedRevision: 1 }).reason, 'preset-store-write-failed');
    assert.deepEqual(registry.snapshot(), before);
    assert.deepEqual(createPresetRegistry({ storage }).getCurrent('prompt-preset'), preset);
});


test('gate:presets:legacy-imagegen-import-preserves-source-and-rejects-recall-activation', () => {
    const source = { items: [
        { kind: 'imagegen', id: 'legacy.imagegen', name: 'Legacy image preset',
            prompts: [{ identifier: 'framework', role: 'system', content: 'Preserve {{description}}.' }],
            prompt_order: [{ identifier: 'framework', enabled: true }] },
        { kind: 'recall', id: 'legacy.recall', prompts: [] },
    ] };
    const registry = createPresetRegistry(), before = structuredClone(source);
    const preview = registry.previewPromptImport(JSON.stringify(source));
    assert.equal(preview.ok, true);
    assert.equal(preview.accepted.length, 1);
    assert.equal(preview.skipped.length, 1);
    assert.equal(preview.accepted[0].activatable, false);
    assert.equal(registry.commitPromptImport(preview).ok, true);
    const imagegen = source.items.find((item) => item.kind === 'imagegen');
    const saved = registry.exportPreset('prompt-preset', imagegen.id);
    assert.deepEqual(saved.data.prompts, imagegen.prompts);
    assert.deepEqual(saved.data.prompt_order, imagegen.prompt_order);
    assert.deepEqual(saved.data.compatibility.source, imagegen);
    assert.equal(registry.setCurrent('prompt-preset', imagegen.id).reason, 'prompt-not-activatable');
    assert.equal(registry.getCurrent('prompt-preset'), null);
    assert.equal(registry.previewPromptImport(source.items.filter((item) => item.kind === 'recall')[0]).ok, false);
    const restored = createPresetRegistry();
    assert.equal(restored.commitPromptImport(restored.previewPromptImport(saved)).ok, true);
    assert.deepEqual(restored.exportPreset('prompt-preset', imagegen.id), saved);
    assert.deepEqual(source, before);
});

test('gate:presets:prompt-import-rejects-duplicate-json-fields-without-writing', () => {
    const registry = createPresetRegistry(), before = registry.snapshot();
    for (const json of ['{"items":[],"items":[]}', '{"a":{"id":"one","id":"two"}}',
        '{"a":[{"id":1,"i\\u0064":2}]}']) {
        assert.equal(registry.previewPromptImport(json).reason, 'duplicate-json-field');
    }
    assert.equal(registry.previewPromptImport('{broken').reason, 'invalid-json');
    assert.deepEqual(registry.snapshot(), before);
});

test('gate:presets:prompt-read-failure-preserves-storage-and-snapshot-advancement-merges-real-edits', async () => {
    const { PRESET_STORE_KEY } = await import('../src/storage/preset-store.js');
    for (const raw of ['{broken', 'null', '{"version":9,"current":{},"items":{}}']) {
        const storage = createMemoryStorage({ [PRESET_STORE_KEY]: raw });
        const registry = createPresetRegistry({ storage }), disk = storage.dump();
        assert.equal(registry.getStatus().ok, false);
        assert.equal(registry.previewPromptImport(await imagePromptPresetFixture()).reason, 'preset-store-unreadable');
        assert.equal(registry.savePromptPreset(await imagePromptPresetFixture(), null).reason, 'preset-store-unreadable');
        assert.deepEqual(storage.dump(), disk);
    }
    const storage = createMemoryStorage(), a = createPresetRegistry({ storage }), b = createPresetRegistry({ storage });
    const preview = b.previewPromptImport(await imagePromptPresetFixture('b'));
    assert.equal(a.savePromptPreset(await imagePromptPresetFixture('a'), null).ok, true);
    assert.equal(b.commitPromptImport(preview).ok, true);
    const reloaded = createPresetRegistry({ storage });
    assert.equal(reloaded.get('prompt-preset', 'a').id, 'a');
    assert.equal(reloaded.get('prompt-preset', 'b').id, 'b');
    let failed = true;
    const read = storage.getItem;
    storage.getItem = key => { if (failed) throw new Error('temporary-read'); return read(key); };
    const recovered = createPresetRegistry({ storage });
    assert.equal(recovered.getStatus().ok, false);
    failed = false;
    assert.equal(recovered.savePromptPreset(await imagePromptPresetFixture('c'), null).ok, true);
    assert.equal(createPresetRegistry({ storage }).list('prompt-preset').length, 3);
});


test('gate:presets:prompt-activation-invalid-shapes-fail-closed', async () => {
    const { validatePromptActivation, validatePromptPreset } = await import('../src/presets/prompt-preset.js');
    const good = await imagePromptPresetFixture();
    assert.equal(validatePromptActivation(good.data).ok, true);
    const cases = [
        (d) => { d.prompts.push(structuredClone(d.prompts[0])); },
        (d) => { d.prompts[0].role = 'tool'; },
        (d) => { d.prompt_order.push({ identifier: 'missing' }); },
        (d) => { d.prompt_order.push(structuredClone(d.prompt_order[0])); },
        (d) => { d.prompts[1].enabled = false; },
        (d) => { d.prompts[2].content = '{{任务资料}} {{任务资料}}'; },
        (d) => { d.prompts[0].injection_depth = 1; },
        (d) => { d.prompts[0].execute = 'unsupported'; },
        (d) => { d.prompts[0].content = '{{未知宏}}'; },
        (d) => { d.taskMap.cg = 'module.item'; },
        (d) => { delete d.taskMap.consistency; },
        (d) => { d.modules[0].role = 'assistant'; },
        (d) => { d.modules[0].contentByFormat = []; },
        (d) => { d.modules[0].contentByFormat = { unknown: 'invalid' }; },
        (d) => { d.modules[0].contentByFormat = { 'sprite-data': '' }; },
        (d) => { d.modules[0].contentByFormat = { 'sprite-data': '{{未知宏}}' }; },
        (d) => { d.modules[0].contentByFormat = { 'sprite-data': '{{任务资料}}' }; },
        (d) => { d.prompts[1].contentByFormat = { 'sprite-data': 'invalid-slot' }; },
        (d) => { d.modules[0].dataFields = {}; },
        (d) => { d.modules[0].requiredFields = ['secret']; },
    ];
    for (const mutate of cases) {
        const invalid = structuredClone(good);
        mutate(invalid.data);
        assert.equal(validatePromptActivation(invalid.data).ok, false);
    }
    assert.equal(validatePromptPreset({ arbitraryLegacyData: true }).ok, true);
});

test('gate:presets:public-prompt-api-shares-registry-and-cannot-replace-imagegen-with-generic', async () => {
    const storage = createMemoryStorage(), registry = createPresetRegistry({ storage });
    const preset = await imagePromptPresetFixture();
    const api = createPublicApi({ version: 'fixture', presetRegistry: registry }).api.promptPresets;
    assert.equal(api.register(preset).ok, true);
    assert.equal(api.setCurrent(preset.id).ok, true);
    assert.deepEqual(api.getCurrent(), registry.getCurrent('prompt-preset'));
    assert.deepEqual(createPresetRegistry({ storage }).getCurrent('prompt-preset'), preset);
    const before = registry.snapshot();
    const generic = { ...preset, data: { legacy: true } };
    assert.equal(api.register(generic).reason, 'preset-id-conflict');
    assert.deepEqual(registry.snapshot(), before);
    const invalid = structuredClone(preset);
    invalid.data.prompts[1].enabled = false;
    assert.equal(registry.savePromptPreset(invalid, 1).reason, 'prompt-not-activatable');
    assert.deepEqual(registry.snapshot(), before);
    assert.deepEqual(api.exportAll().items, [preset]);
});

test('gate:presets:image-default-initializes-in-one-snapshot', async () => {
    const { createDefaultImagePromptPreset } = await import('../src/generated-images/image-prompt-defaults.js');
    const { renderImagePromptPreset } = await import('../src/presets/prompt-preset-renderer.js');
    const memory = createMemoryStorage();
    let writes = 0;
    const storage = { ...memory, setItem(key, value) { writes += 1; memory.setItem(key, value); } };
    const registry = createPresetRegistry({ storage });
    const preset = createDefaultImagePromptPreset();
    assert.equal(registry.ensureImagePromptDefault(preset).ok, true);
    assert.equal(writes, 1);
    assert.deepEqual(createPresetRegistry({ storage }).getCurrent('prompt-preset'), preset);
    assert.equal(registry.ensureImagePromptDefault(preset).changed, false);
    assert.equal(writes, 1);
    assert.equal(renderImagePromptPreset(preset.data, 'unknown', {}).reason, 'unknown-image-prompt-task');
    assert.equal(renderImagePromptPreset(preset.data, 'item', {}).reason, 'missing-prompt-data');
});

test('gate:presets:image-default-init-failure-keeps-snapshot-and-current', async () => {
    const { createDefaultImagePromptPreset } = await import('../src/generated-images/image-prompt-defaults.js');
    const preset = createDefaultImagePromptPreset();
    const memory = createMemoryStorage();
    const registry = createPresetRegistry({ storage: { ...memory, setItem() { throw new Error('fake-quota'); } } });
    const before = registry.snapshot(), disk = memory.dump();
    assert.equal(registry.ensureImagePromptDefault(preset).ok, false);
    assert.deepEqual(registry.snapshot(), before);
    assert.deepEqual(memory.dump(), disk);
    const unreadable = createPresetRegistry({ storage: { ...memory, getItem() { throw new Error('fake-read'); } } });
    assert.equal(unreadable.ensureImagePromptDefault(preset).reason, 'preset-store-unreadable');
    assert.deepEqual(memory.dump(), disk);
    const good = createPresetRegistry();
    const custom = await imagePromptPresetFixture('custom-default');
    assert.equal(good.register(custom).ok, true);
    assert.equal(good.setCurrent('prompt-preset', custom.id).ok, true);
    const customSnapshot = good.snapshot();
    assert.equal(good.ensureImagePromptDefault(preset).changed, false);
    assert.deepEqual(good.snapshot(), customSnapshot);
    const invalid = createPresetRegistry(), broken = structuredClone(preset);
    broken.data.prompts[1].enabled = false;
    assert.equal(invalid.ensureImagePromptDefault(broken).reason, 'prompt-not-activatable');
    assert.equal(invalid.getCurrent('prompt-preset'), null);
});

for (const customized of [false, true]) test(`gate:presets:cg-catalog-upgrade-${customized ? 'custom' : 'default'}`, async () => {
    const { createDefaultImagePromptPreset } = await import('../src/generated-images/image-prompt-defaults.js');
    const { promptDefaultState } = await import('../src/presets/prompt-default-operations.js');
    const latest = createDefaultImagePromptPreset(), old = structuredClone(latest);
    old.version = 25; old.data.defaultVersion = 25;
    delete old.data.defaultState;
    for (const module of old.data.modules) module.dataFields = module.dataFields.filter(f => f !== 'outfitCatalog');
    const storage = createMemoryStorage(), registry = createPresetRegistry({ storage });
    assert.equal(registry.ensureImagePromptDefault(promptDefaultState(old)).ok, true);
    const custom = registry.getCurrent('prompt-preset');
    const cg = custom.data.modules.find(m => m.task === 'cg');
    cg.content = '用户保留的 CG 要求';
    if (customized) cg.dataFields = cg.dataFields.filter(f => f !== 'lore');
    custom.data.prompts.find(b => b.identifier === 'igs-image-submit').enabled = false;
    assert.equal(registry.savePromptPreset(custom, 1).ok, true);
    const before = registry.getCurrent('prompt-preset');
    assert.equal(registry.upgradeImagePromptDefault(latest, 2).ok, true);
    const current = createPresetRegistry({ storage }).getCurrent('prompt-preset');
    const upgraded = current.data.modules.find(m => m.task === 'cg');
    assert.deepEqual(upgraded.dataFields, customized ? cg.dataFields : [...cg.dataFields, 'outfitCatalog']);
    assert.equal(upgraded.content, cg.content);
    assert.equal(current.data.prompts.find(b => b.identifier === 'igs-image-submit').enabled, false);
    assert.deepEqual(current.data.defaultState.backups.at(-1).data.modules, before.data.modules);
    assert.deepEqual(current.data.modules.find(m => m.task === 'sprite').dataFields,
        before.data.modules.find(m => m.task === 'sprite').dataFields);
    const snapshot = registry.snapshot();
    assert.equal(registry.ensureImagePromptDefault(latest).changed, false);
    assert.deepEqual(registry.snapshot(), snapshot);
});

test('gate:presets:image-default-upgrade-preserves-custom-blocks-and-restores-by-id', async () => {
    const { createDefaultImagePromptPreset } = await import('../src/generated-images/image-prompt-defaults.js');
    const storage = createMemoryStorage(), registry = createPresetRegistry({ storage });
    const initial = createDefaultImagePromptPreset();
    assert.equal(registry.ensureImagePromptDefault(initial).ok, true);
    const custom = registry.getCurrent('prompt-preset');
    custom.data.modules.find(m => m.task === 'avatar').content = '用户头像要求';
    custom.data.prompts.find(b => b.identifier === 'igs-image-submit').enabled = false;
    [custom.data.prompt_order[1], custom.data.prompt_order[2]] = [custom.data.prompt_order[2], custom.data.prompt_order[1]];
    assert.equal(registry.savePromptPreset(custom, 1).ok, true);
    const before = registry.getCurrent('prompt-preset');
    const latest = createDefaultImagePromptPreset();
    latest.data.defaultVersion = initial.data.defaultVersion + 1;
    latest.data.prompts[0].content = '新版共享框架';
    latest.data.modules.find(m => m.task === 'avatar').content = '新版头像规则';
    latest.data.modules.find(m => m.task === 'sprite').content = '新版立绘规则';
    const upgraded = registry.upgradeImagePromptDefault(latest, 2);
    assert.equal(upgraded.ok, true, JSON.stringify(upgraded));
    const current = registry.getCurrent('prompt-preset');
    assert.equal(current.data.revision, 3);
    assert.equal(current.data.prompts[0].content, '新版共享框架');
    assert.equal(current.data.modules.find(m => m.task === 'avatar').content, '用户头像要求');
    assert.equal(current.data.modules.find(m => m.task === 'sprite').content, '新版立绘规则');
    assert.deepEqual(current.data.prompt_order, before.data.prompt_order);
    assert.equal(current.data.prompts.find(b => b.identifier === 'igs-image-submit').enabled, false);
    assert.equal(current.data.defaultState.backups[0].revision, 2);
    assert.deepEqual(createPresetRegistry({ storage }).getCurrent('prompt-preset'), current);
    const snapshot = registry.snapshot();
    assert.equal(registry.ensureImagePromptDefault(latest).changed, false);
    assert.deepEqual(registry.snapshot(), snapshot);
    const options = { expectedRevision: 3, group: 'modules', identifier: 'igs-task-sprite', backupRevision: 2 };
    const restored = registry.restoreImagePromptBlock(current.id, options);
    assert.equal(restored.ok, true, JSON.stringify(restored));
    const after = registry.getCurrent('prompt-preset');
    assert.equal(after.data.modules.find(m => m.task === 'sprite').content, initial.data.modules.find(m => m.task === 'sprite').content);
    assert.equal(after.data.modules.find(m => m.task === 'avatar').content, '用户头像要求');
    assert.deepEqual(after.data.prompt_order, before.data.prompt_order);
    assert.equal(after.data.revision, 4);
    const restoredSnapshot = registry.snapshot(), restoredDisk = storage.dump();
    const repeated = registry.restoreImagePromptBlock(current.id, options);
    assert.deepEqual({ ok: repeated.ok, changed: repeated.changed }, { ok: true, changed: false });
    assert.deepEqual(registry.snapshot(), restoredSnapshot);
    assert.deepEqual(storage.dump(), restoredDisk);
});

test('gate:presets:image-default-v1-to-latest-upgrades-protocol-and-keeps-custom-state', async () => {
    const { createDefaultImagePromptPreset } = await import('../src/generated-images/image-prompt-defaults.js');
    const { promptDefaultState } = await import('../src/presets/prompt-default-operations.js');
    const latest = createDefaultImagePromptPreset();
    assert.equal(latest.data.defaultVersion, latest.version);
    assert.ok(latest.data.defaultVersion > 2);
    const old = structuredClone(latest);
    old.version = 1; old.data.defaultVersion = 1;
    delete old.data.defaultState;
    old.data.modules.find(m => m.task === 'sprite').content = '绘制单人立绘，保持指定景别与可抠除底色，选择不遮挡身体的轻量日常动作。缺身份景别时在同次模板回复中建立三景别 DNA 候选；已有身份原样引用。';
    const protocol = old.data.prompts.find(b => b.identifier === 'igs-image-protocol');
    protocol.content = protocol.content.split('\n').map(line => {
        if (line.startsWith('dna-template：')) return 'dna-template：每份从 slotid: 允许正整数 开始，份间用独立行 --- 分隔。写 prompt_mode: dna_template、scene、scene_uc；可写 size: 宽x高、analysis，编号正文任务必须写 at。尺寸遵守本轮输入。';
        if (line.startsWith('模板每个 char 后')) return '模板每个 char 后紧接 char_uc，UC 可空。char 可用 x,y | 正文，坐标为0到1。named 用本人的 <<dna:token>> 一次作主语，可在本人 char_uc 使用 <<dna_uc:token>> 一次；不复制固定外貌。outfitMode 为 template 时写 outfit_mode: template，每个 named 的正向 char 含本人的 <<outfit:token>> 一次，不复制衣装正文。';
        return line;
    }).join('\n');
    const storage = createMemoryStorage(), registry = createPresetRegistry({ storage });
    assert.equal(registry.ensureImagePromptDefault(promptDefaultState(old)).ok, true);
    const custom = registry.getCurrent('prompt-preset');
    custom.data.modules.find(m => m.task === 'avatar').content = '用户头像要求';
    custom.data.prompts.find(b => b.identifier === 'igs-image-submit').enabled = false;
    custom.data.prompts.find(b => b.identifier === 'igs-image-protocol').role = 'user';
    [custom.data.prompt_order[1], custom.data.prompt_order[2]] = [custom.data.prompt_order[2], custom.data.prompt_order[1]];
    assert.equal(registry.savePromptPreset(custom, 1).ok, true);
    const before = registry.getCurrent('prompt-preset');
    assert.equal(registry.ensureImagePromptDefault(latest).changed, true);
    const current = registry.getCurrent('prompt-preset');
    assert.equal(current.data.defaultVersion, latest.data.defaultVersion);
    assert.equal(current.data.revision, 3);
    for (const [group, id] of [['modules', 'igs-task-sprite'], ['prompts', 'igs-image-protocol']]) {
        assert.equal(current.data[group].find(b => b.identifier === id).content,
            latest.data[group].find(b => b.identifier === id).content);
    }
    assert.equal(current.data.modules.find(m => m.task === 'avatar').content, '用户头像要求');
    assert.deepEqual(current.data.prompt_order, before.data.prompt_order);
    for (const block of before.data.prompts) {
        const upgraded = current.data.prompts.find(b => b.identifier === block.identifier);
        assert.equal(upgraded.role, block.role); assert.equal(upgraded.enabled, block.enabled);
    }
    assert.deepEqual(current.data.defaultState.backups[0].data, (() => {
        const copy = structuredClone(before.data); delete copy.defaultState; return copy;
    })());
    const reopened = createPresetRegistry({ storage });
    assert.deepEqual(reopened.getCurrent('prompt-preset'), current);
    const snapshot = reopened.snapshot();
    assert.equal(reopened.ensureImagePromptDefault(latest).changed, false);
    assert.deepEqual(reopened.snapshot(), snapshot);
});

test('gate:presets:image-default-v2-to-latest-separates-layers-and-preserves-custom-blocks', async () => {
    const { createDefaultImagePromptPreset } = await import('../src/generated-images/image-prompt-defaults.js');
    const { promptDefaultState } = await import('../src/presets/prompt-default-operations.js');
    const latest = createDefaultImagePromptPreset();
    const targets = [['prompts', 'igs-image-framework'], ['prompts', 'igs-image-protocol'],
        ['modules', 'igs-task-sprite'], ['modules', 'igs-task-dna']];
    for (const customId of ['', 'igs-image-framework', 'igs-image-protocol', 'igs-task-sprite', 'igs-task-dna']) {
        const old = structuredClone(latest);
        old.version = 2; old.data.defaultVersion = 2; delete old.data.defaultState;
        // 注册表以每份持久基线为权威，不以当前新默认反推旧正文。
        for (const [group, id] of targets) old.data[group].find(b => b.identifier === id).content = `v2 已保存默认正文 ${id}`;
        const storage = createMemoryStorage(), registry = createPresetRegistry({ storage });
        assert.equal(registry.ensureImagePromptDefault(promptDefaultState(old)).ok, true);
        const edited = registry.getCurrent('prompt-preset');
        if (customId) for (const group of ['prompts', 'modules']) {
            const block = edited.data[group].find(b => b.identifier === customId);
            if (block) block.content = '用户自定义正文，不自动覆盖';
        }
        edited.data.prompts[0].role = 'user'; edited.data.prompts[0].enabled = false;
        edited.data.prompt_order.reverse();
        assert.equal(registry.savePromptPreset(edited, 1).ok, true);
        const before = registry.getCurrent('prompt-preset');
        assert.equal(registry.ensureImagePromptDefault(latest).changed, true);
        const current = registry.getCurrent('prompt-preset');
        assert.equal(current.data.defaultVersion, latest.data.defaultVersion);
        for (const [group, id] of targets) assert.equal(current.data[group].find(b => b.identifier === id).content,
            id === customId ? '用户自定义正文，不自动覆盖' : latest.data[group].find(b => b.identifier === id).content);
        assert.deepEqual(current.data.prompt_order, before.data.prompt_order);
        assert.equal(current.data.prompts[0].role, 'user'); assert.equal(current.data.prompts[0].enabled, false);
        const backup = structuredClone(before.data); delete backup.defaultState;
        assert.deepEqual(current.data.defaultState.backups.at(-1).data, backup);
        const reopened = createPresetRegistry({ storage });
        assert.deepEqual(reopened.getCurrent('prompt-preset'), current);
        assert.equal(reopened.ensureImagePromptDefault(latest).changed, false);
    }
});

test('gate:presets:image-default-v3-v4-v5-v6-v7-v8-to-latest-all-task-upgrade-keeps-custom-state', async () => {
    const { createDefaultImagePromptPreset } = await import('../src/generated-images/image-prompt-defaults.js');
    const { promptDefaultState } = await import('../src/presets/prompt-default-operations.js');
    const latest = createDefaultImagePromptPreset();
    const targets = ['igs-image-framework', 'igs-image-protocol', ...latest.data.modules.map(row => row.identifier)];
    for (const version of [3, 4, 5, 6, 7, 8]) for (const customId of ['', ...targets]) {
        const old = structuredClone(latest);
        old.version = version; old.data.defaultVersion = version; delete old.data.defaultState;
        for (const group of ['prompts', 'modules']) for (const block of old.data[group])
            if (targets.includes(block.identifier)) block.content = `v${version} saved baseline ${block.identifier}`;
        const storage = createMemoryStorage(), registry = createPresetRegistry({ storage });
        assert.equal(registry.ensureImagePromptDefault(promptDefaultState(old)).ok, true);
        const edited = registry.getCurrent('prompt-preset');
        for (const group of ['prompts', 'modules']) for (const block of edited.data[group])
            if (block.identifier === customId) block.content = '用户自定义正文';
        edited.data.prompts[0].role = 'user'; edited.data.prompts[0].enabled = false;
        edited.data.prompt_order.reverse();
        assert.equal(registry.savePromptPreset(edited, 1).ok, true);
        const before = registry.getCurrent('prompt-preset');
        assert.equal(registry.ensureImagePromptDefault(latest).changed, true);
        const current = registry.getCurrent('prompt-preset');
        assert.equal(current.data.defaultVersion, latest.data.defaultVersion);
        for (const group of ['prompts', 'modules']) for (const block of current.data[group]) {
            const expected = latest.data[group].find(row => row.identifier === block.identifier);
            assert.equal(block.content, block.identifier === customId ? '用户自定义正文' : expected.content);
            const prior = before.data[group].find(row => row.identifier === block.identifier);
            assert.equal(block.role, prior.role); assert.equal(block.enabled, prior.enabled);
        }
        assert.deepEqual(current.data.prompt_order, before.data.prompt_order);
        const backup = structuredClone(before.data); delete backup.defaultState;
        assert.deepEqual(current.data.defaultState.backups.at(-1).data, backup);
        const reopened = createPresetRegistry({ storage });
        assert.deepEqual(reopened.getCurrent('prompt-preset'), current);
        assert.equal(reopened.ensureImagePromptDefault(latest).changed, false);
    }
});



test('gate:presets:image-default-upgrade-and-restore-write-failure-are-atomic', async () => {
    const { createDefaultImagePromptPreset } = await import('../src/generated-images/image-prompt-defaults.js');
    const memory = createMemoryStorage();
    let rejectWrite = false;
    const storage = { ...memory, setItem(key, value) {
        if (rejectWrite) throw new Error('fake-quota');
        memory.setItem(key, value);
    } };
    const registry = createPresetRegistry({ storage }), initial = createDefaultImagePromptPreset();
    assert.equal(registry.ensureImagePromptDefault(initial).ok, true);
    const latest = createDefaultImagePromptPreset();
    latest.data.defaultVersion = initial.data.defaultVersion + 1;
    latest.data.prompts[0].content = '新版共享规则';
    const before = registry.snapshot(), disk = memory.dump();
    rejectWrite = true;
    assert.equal(registry.upgradeImagePromptDefault(latest, 1).ok, false);
    assert.deepEqual(registry.snapshot(), before);
    assert.deepEqual(memory.dump(), disk);
    rejectWrite = false;
    assert.equal(registry.upgradeImagePromptDefault(latest, 1).ok, true);
    const upgraded = registry.snapshot(), upgradedDisk = memory.dump();
    rejectWrite = true;
    assert.equal(registry.restoreImagePromptBlock(initial.id, { expectedRevision: 2,
        group: 'prompts', identifier: 'igs-image-framework', backupRevision: 1 }).ok, false);
    assert.deepEqual(registry.snapshot(), upgraded);
    assert.deepEqual(memory.dump(), upgradedDisk);
    assert.deepEqual(createPresetRegistry({ storage: memory }).snapshot(), upgraded);
});

test('gate:presets:image-format-routing-rejects-unmapped-task-format', async () => {
    const { renderImagePromptPreset } = await import('../src/presets/prompt-preset-renderer.js');
    const preset = await imagePromptPresetFixture();
    for (const module of preset.data.modules) {
        module.dataFields = ['description', 'outputs'];
        module.contentByFormat = { [module.task === 'item' ? 'asset-plan' : 'dna-template']: '合成格式规则' };
    }
    const before = structuredClone(preset);
    for (const [task, format, ok] of [
        ['cg', 'dna-template', true], ['consistency', 'dna-template', true],
        ['item', 'asset-plan', true], ['item', 'dna-template', false],
        ['cg', 'asset-plan', false], ['consistency', 'sprite-data', false],
    ]) {
        const result = renderImagePromptPreset(preset.data, task, { description: '隔离资料', outputs: { format } });
        assert.equal(result.ok, ok);
        if (ok) assert.equal(result.moduleId, `module.${task}`);
        else assert.equal(result.reason, 'unsupported-prompt-format');
    }
    assert.deepEqual(preset, before);
});


test('gate:presets:image-format-upgrade-restores-map-and-preserves-custom-map', async () => {
    const { createDefaultImagePromptPreset } = await import('../src/generated-images/image-prompt-defaults.js');
    const { promptDefaultState } = await import('../src/presets/prompt-default-operations.js');
    for (const custom of [false, true]) {
        const latest = createDefaultImagePromptPreset(), initial = structuredClone(latest);
        delete initial.data.defaultState;
        initial.data.defaultVersion = latest.data.defaultVersion - 1;
        for (const module of initial.data.modules) delete module.contentByFormat;
        const storage = createMemoryStorage(), registry = createPresetRegistry({ storage });
        assert.equal(registry.ensureImagePromptDefault(promptDefaultState(initial)).ok, true);
        const edited = registry.getCurrent('prompt-preset');
        const cg = edited.data.modules.find(m => m.task === 'cg');
        if (custom) cg.contentByFormat = { 'dna-template': '自定义格式正文' };
        assert.equal(registry.savePromptPreset(edited, 1).ok, true);
        const prior = registry.getCurrent('prompt-preset');
        assert.equal(registry.upgradeImagePromptDefault(latest, 2).ok, true);
        const upgraded = registry.getCurrent('prompt-preset');
        const expected = custom ? cg.contentByFormat : latest.data.modules.find(m => m.task === 'cg').contentByFormat;
        assert.deepEqual(upgraded.data.modules.find(m => m.task === 'cg').contentByFormat, expected);
        assert.deepEqual(createPresetRegistry({ storage }).getCurrent('prompt-preset'), upgraded);
        assert.equal(registry.restoreImagePromptBlock(latest.id, {
            expectedRevision: 3, group: 'modules', identifier: cg.identifier, backupRevision: 2,
        }).ok, true);
        const restored = registry.getCurrent('prompt-preset');
        assert.deepEqual(restored.data.modules.find(m => m.task === 'cg').contentByFormat,
            prior.data.modules.find(m => m.task === 'cg').contentByFormat);
        assert.equal(Object.hasOwn(restored.data.modules.find(m => m.task === 'cg'), 'contentByFormat'), custom);
        assert.equal(restored.data.revision, custom ? upgraded.data.revision : upgraded.data.revision + 1);
        assert.equal(registry.restoreImagePromptBlock(latest.id, {
            expectedRevision: restored.data.revision, group: 'modules', identifier: cg.identifier,
        }).ok, true);
        assert.deepEqual(registry.getCurrent('prompt-preset').data.modules.find(m => m.task === 'cg').contentByFormat,
            latest.data.modules.find(m => m.task === 'cg').contentByFormat);
    }
});


test('gate:image-worldinfo:v20升级补参考块并保留配置与删除状态', async () => {
    const { createDefaultImagePromptPreset } = await import('../src/generated-images/image-prompt-defaults.js');
    const { promptDefaultState } = await import('../src/presets/prompt-default-operations.js');
    const latest = createDefaultImagePromptPreset(), old = structuredClone(latest);
    old.version = 20; old.data.defaultVersion = 20; delete old.data.defaultState;
    const worldId = 'igs-image-world';
    old.data.prompts = old.data.prompts.filter(b => b.identifier !== worldId);
    old.data.prompt_order = old.data.prompt_order.filter(b => b.identifier !== worldId);
    old.data.variables = old.data.variables.filter(v => v !== '世界书');
    const memory = createMemoryStorage();
    let rejectWrite = false;
    const storage = { ...memory, setItem(key, value) {
        if (rejectWrite) throw new Error('fake-quota');
        memory.setItem(key, value);
    } };
    const registry = createPresetRegistry({ storage });
    assert.equal(registry.ensureImagePromptDefault(promptDefaultState(old)).ok, true);
    const edited = registry.getCurrent('prompt-preset');
    edited.data.prompts[0].content = '自定义框架';
    edited.data.prompts[0].role = 'assistant';
    edited.data.prompts[0].enabled = false;
    edited.data.prompt_order.reverse();
    assert.equal(registry.savePromptPreset(edited, 1).ok, true);
    const before = registry.snapshot(), disk = memory.dump();
    rejectWrite = true;
    assert.equal(registry.ensureImagePromptDefault(latest).ok, false);
    assert.deepEqual(registry.snapshot(), before); assert.deepEqual(memory.dump(), disk);
    rejectWrite = false;
    assert.equal(registry.ensureImagePromptDefault(latest).changed, true);
    const current = registry.getCurrent('prompt-preset');
    assert.equal(current.data.prompts.filter(b => b.identifier === worldId).length, 1);
    assert.deepEqual(current.data.prompts.filter(b => b.identifier !== worldId), edited.data.prompts);
    assert.deepEqual(current.data.prompt_order.filter(b => b.identifier !== worldId), edited.data.prompt_order);
    assert.deepEqual(createPresetRegistry({ storage }).getCurrent('prompt-preset'), current);
    const backup = structuredClone(before.items['prompt-preset'][latest.id].data); delete backup.defaultState;
    assert.deepEqual(current.data.defaultState.backups.at(-1).data, backup);
    current.data.prompts = current.data.prompts.filter(b => b.identifier !== worldId);
    current.data.prompt_order = current.data.prompt_order.filter(b => b.identifier !== worldId);
    assert.equal(registry.savePromptPreset(current, current.data.revision).ok, true);
    const next = structuredClone(latest); next.data.defaultVersion++;
    assert.equal(registry.ensureImagePromptDefault(next).ok, true);
    assert.equal(registry.getCurrent('prompt-preset').data.prompts.some(b => b.identifier === worldId), false);

    // v21/v22 已有参考块：只迁移未调整的顺序，原配置随同一快照保存。
    const ids = order => order.map(entry => entry.identifier);
    for (const previousVersion of [21, 22])
    for (const mode of ['baseline', 'custom-order', 'deleted', 'excluded', 'custom-block']) {
        const previous = structuredClone(latest);
        previous.version = previousVersion; previous.data.defaultVersion = previousVersion;
        delete previous.data.defaultState;
        const order = previous.data.prompt_order;
        const worldIndex = order.findIndex(entry => entry.identifier === worldId);
        const [worldEntry] = order.splice(worldIndex, 1);
        order.splice(order.findIndex(entry => entry.identifier === 'igs-image-data') + 1, 0, worldEntry);
        const store = createMemoryStorage();
        let blockWrite = false;
        const savedStorage = { ...store, setItem(key, value) {
            if (blockWrite) throw new Error('fake-quota');
            store.setItem(key, value);
        } };
        const savedRegistry = createPresetRegistry({ storage: savedStorage });
        assert.equal(savedRegistry.ensureImagePromptDefault(promptDefaultState(previous)).ok, true);
        const saved = savedRegistry.getCurrent('prompt-preset');
        const reference = saved.data.prompts.find(block => block.identifier === worldId);
        reference.content = '用户自定义参考 {{世界书}}';
        reference.role = 'assistant'; reference.enabled = false;
        saved.data.prompt_order.find(entry => entry.identifier === worldId).enabled = false;
        if (mode === 'custom-order') saved.data.prompt_order.reverse();
        if (mode === 'deleted') saved.data.prompts = saved.data.prompts.filter(block => block.identifier !== worldId);
        if (mode === 'deleted' || mode === 'excluded')
            saved.data.prompt_order = saved.data.prompt_order.filter(entry => entry.identifier !== worldId);
        if (mode === 'custom-block') {
            saved.data.prompts.push({ identifier: 'user-reference', role: 'user', kind: 'shared', content: '用户资料', enabled: true });
            saved.data.prompt_order.push({ identifier: 'user-reference', enabled: true });
        }
        assert.equal(savedRegistry.savePromptPreset(saved, 1).ok, true);
        const snapshot = savedRegistry.snapshot(), persisted = store.dump();
        blockWrite = true;
        assert.equal(savedRegistry.ensureImagePromptDefault(latest).ok, false);
        assert.deepEqual(savedRegistry.snapshot(), snapshot);
        assert.deepEqual(store.dump(), persisted);
        blockWrite = false;
        assert.equal(savedRegistry.ensureImagePromptDefault(latest).changed, true);
        const upgraded = savedRegistry.getCurrent('prompt-preset');
        const expectedOrder = mode === 'baseline' ? ids(latest.data.prompt_order)
            .map(id => saved.data.prompt_order.find(entry => entry.identifier === id)) : saved.data.prompt_order;
        assert.deepEqual(upgraded.data.prompt_order, expectedOrder, mode);
        assert.deepEqual(upgraded.data.prompts, saved.data.prompts, mode);
        assert.equal(upgraded.data.defaultVersion, latest.data.defaultVersion);
        const backup = structuredClone(snapshot.items['prompt-preset'][latest.id].data); delete backup.defaultState;
        assert.deepEqual(upgraded.data.defaultState.backups.at(-1).data, backup);
        assert.deepEqual(createPresetRegistry({ storage: store }).getCurrent('prompt-preset'), upgraded);
        const stable = savedRegistry.snapshot();
        assert.equal(savedRegistry.ensureImagePromptDefault(latest).changed, false);
        assert.deepEqual(savedRegistry.snapshot(), stable);
    }
});
