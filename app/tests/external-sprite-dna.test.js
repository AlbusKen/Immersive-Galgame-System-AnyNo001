import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { builtinImageHarness } from './helpers/builtin-image-harness.js';
import { createAssetGenerationService } from './helpers/media-fixtures.js';
import { createMemoryGeneratedAssetStore } from '../src/media/generated-asset-store.js';
import { createMemoryStorage } from '../src/storage/preset-store.js';
import { createImageBackend } from '../src/generated-images/image-backend.js';
import { createCharacterDnaStore } from '../src/core/character-dna-store.js';
import { handleSettingsAction } from '../src/visual/igs-ui/settings-actions.js';
import { normalizeBridgeConfig } from '../src/visual/igs-ui/settings-host-normalize.js';
import { bootstrapIGS } from '../src/index.js';
import { createMemoryIllustrationStore, floorKeyOf } from '../src/media/illustration-store.js';
import { createIllustrationMessageHost } from '../src/host/illustration-message-host.js';
import { createStoryOutfitService } from '../src/generated-images/illustration/story-outfit-service.js';
import { editCharacterDnaField, normalizeCharacterDna } from '../src/scene/character-dna.js';
import { migrateSpriteSystem } from '../src/scene/sprite-system-migration.js';
import { resolveSpriteAsset } from '../src/scene/asset-match.js';

const caption = { v4_prompt: { caption: { base_caption: 'plugin composition',
    char_captions: [{ char_caption: 'plugin complete character, sitting', centers: [{ x: 0.2, y: 0.8 }] }] } },
    v4_negative_prompt: { caption: { base_caption: 'plugin negative', char_captions: [{ char_caption: '' }] } } };

function fixture(t, options = {}) {
    const bridge = { imageApi: { mode: 'dbgen', externalSpriteDna: options.enabled !== false },
        autoIllustration: { retry: { enabled: false }, assets: { spriteEnabled: true, backgroundEnabled: false } },
        sceneAssets: { enabled: true, characters: { Alice: {} },
            ...(options.dna && { characterDna: { Alice: structuredClone(options.dna) } }) } };
    const order = [], writes = [], paints = [];
    const h = builtinImageHarness({ bridge, ...options, afterWrite: input => { order.push('dna'); options.afterWrite?.(input); } });
    let context = {}, chatId = 'chat-A', failSave = false;
    const text = options.text || '[igs-char:Alice|平和|Alice 正在说话。]';
    const messageHost = { getChatId: () => chatId, readPreviousAiTexts: () => [], readCharacterLore: async names =>
        names.map(name => ({ name, description: 'Adult woman, silver hair, gentle personality.' })),
        readFloor: id => ({ chatId, messageId: id, swipeId: 0, isAi: true, isLatest: true, text }),
        on: () => () => {} };
    const dnaStore = createCharacterDnaStore({ readAssets: () => bridge.sceneAssets, readContext: () => context,
        saveAssets(next) {
            if (failSave) return { ok: false };
            bridge.sceneAssets = structuredClone(next); order.push('save'); options.afterSave?.(); return { ok: true };
        } });
    const api = { async generateSinglePrompt(request) {
        assert.ok(Object.keys(request).every(key => ['description', 'messageId', 'skipRecall', 'signal'].includes(key)));
        writes.push(request); order.push('plugin-write');
        options.onPluginWrite?.();
        return { ok: true, value: { caption: structuredClone(caption), captions: Array.from({ length: options.spriteCount || 1 },
            (_, index) => ({ slotId: index + 1, caption: structuredClone(caption) })) } };
    }, async generate(request) {
        assert.deepEqual(request.caption, caption, '外部返回完整提示词不得被 DNA 覆盖');
        assert.equal(request.replaceCharacterKeywords, true, '保留 DBGen 自己的关键词替换');
        paints.push(request); order.push('plugin-paint');
        if (options.pluginFailure?.()) return { ok: false, error: { code: 'FIXTURE_PAINT_FAILED', message: 'fixture' } };
        return { ok: true, value: [{ blob: new Blob(['fixture'], { type: 'image/png' }) }] };
    } };
    const backend = createImageBackend({ global: { NaiDbGen: api, btoa }, llm: h.llm,
        taskRuntime: h.runtime, getBridge: () => bridge });
    const store = createMemoryGeneratedAssetStore();
    const service = createAssetGenerationService({ llm: h.llm, nai: backend, store, getSettings: () => bridge,
        captureSpriteGenerationTarget: name => dnaStore.capture(name),
        captureCharacterDnaTarget: name => dnaStore.capture(name),
        messageHost, minBodyChars: 0, matte: async url => url });
    t.after(() => { service.stop(); h.dispose(); });
    return { h, bridge, order, writes, paints, service, store, dnaStore, api, messageHost,
        setContext(value) { context = value; }, setChat(value) { chatId = value; },
        failSave(value = true) { failSave = value; } };
}
async function writing(h, count = 1) {
    for (let i = 0; i < 100 && h.writes.length < count; i++) await setImmediate();
    assert.equal(h.writes.length, count);
}

function batchDnaReply(input) {
    return input.outputs.rows.slice().reverse().map(({ slotId, characterKey }) => [
        `slotid: ${slotId}`, `character: ${characterKey}`, 'personality: calm',
        `outfit_name: ${characterKey}日常装`, 'outfit_description: wears a blue cotton dress',
        ...['full_body', 'half_body', 'portrait'].map(view => `dna_${view}: ${characterKey}, an adult woman with silver hair,`),
    ].join('\n')).join('\n---\n');
}

test('DNA 空回复：自动重取后完成原立绘，并显示原因和次数', { timeout: 4000 }, async t => {
    let attempts = 0;
    const f = fixture(t, { reply: input => ++attempts === 1 ? ''
        : attempts === 2 ? '<think>still thinking</think>  ' : batchDnaReply(input) });
    const progress = [];
    const result = await f.service.generateCharacterSprite({ name: 'Alice', onProgress: event => progress.push(event) });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(f.h.writes.length, 3);
    assert.equal(f.paints.length, 1);
    assert.equal(f.bridge.sceneAssets.characterDna.Alice.version, 2);
    assert.ok(progress.some(event => /空正文.*2\/3/.test(event.message || '')));
    assert.ok(progress.some(event => /空正文.*3\/3/.test(event.message || '')));
    assert.ok(progress.every(event => event.status !== 'waiting-condition'));
    for (const request of f.h.writes) assert.deepEqual(request.input.outputs.rows.map(row => row.characterKey), ['Alice']);
});

test('DNA 空回复：连续为空结束整楼任务，释放锁后能正常再次生成', { timeout: 5000 }, async t => {
    let empty = true;
    const f = fixture(t, { reply: input => empty ? ' \n ' : batchDnaReply(input), spriteCount: 2,
        text: '[igs-char:Alice|平和|Alice 正在说话。]\n[igs-char:Bob|平和|Bob 正在说话。]' });
    f.bridge.sceneAssets.characters = {};
    const failed = await f.service.processMessage(1, { manual: true });
    assert.equal(failed.ok, false);
    assert.equal(failed.reason, 'recovery-exhausted');
    assert.match(failed.error, /3 次.*正文为空/);
    assert.equal(f.h.writes.length, 3, '外层恢复不得重新发起一轮补 DNA');
    assert.equal(f.bridge.sceneAssets.characterDna, undefined);
    assert.equal(f.writes.length + f.paints.length, 0);
    const floor = await f.store.getFloor(floorKeyOf(f.messageHost.readFloor(1)));
    assert.equal(floor.status, 'failed');
    assert.match(floor.error, /正文为空/);
    for (const request of f.h.writes) assert.deepEqual(request.input.outputs.rows.map(row => row.characterKey), ['Alice', 'Bob']);
    empty = false;
    assert.equal((await f.service.processMessage(1, { manual: true })).ok, true);
    assert.equal(f.h.writes.length, 4);
    assert.equal(f.paints.length, 2);
});

test('DNA 空回复：实际设置控制器返回明确错误，原按钮操作不会留在恢复等待', { timeout: 5000 }, async t => {
    let empty = true;
    const f = fixture(t, { reply: input => empty ? '' : batchDnaReply(input) });
    const alerts = [];
    const context = { extensionPrompts: {}, getWorldInfoPrompt: async () => ({ worldInfoString: '' }) };
    const global = { localStorage: createMemoryStorage(), btoa, NaiDbGen: f.api,
        alert: message => alerts.push(message), confirm: () => true, prompt: () => '',
        Image: class { set src(value) { if (value) { this.naturalWidth = 32; this.naturalHeight = 48; queueMicrotask(() => this.onload?.()); } } },
        SillyTavern: { getContext: () => context } };
    const app = bootstrapIGS({ global, config: f.bridge, secondaryLlm: f.h.llm, autoAttachMagicWand: false,
        generatedAssetStore: createMemoryGeneratedAssetStore(), illustrationStore: createMemoryIllustrationStore(), alphaMatte: async url => url,
        illustrationMessageHost: { ...f.messageHost, onImageFloorReady: () => () => {}, destroy() {},
            attachPromptStrip() {}, ensureMarkerRegexes: async () => ({ ok: true }) },
        hostAdapter: { getCurrentMessage: async () => null, typeAndSend: async () => ({ ok: true }) },
        fetch() { assert.fail('不应请求真实网络'); } });
    t.after(() => app.shutdown());
    const opened = app.openSettings({ page: 'source' });
    const failed = await opened.controller.invoke('char-generate-sprite:Alice');
    assert.equal(failed.ok, false);
    assert.equal(failed.reason, 'recovery-exhausted');
    assert.equal(f.h.writes.length, 3);
    assert.equal(alerts.length, 1);
    assert.match(alerts[0], /3 次.*正文为空/);
    empty = false;
    assert.equal((await opened.controller.invoke('char-generate-sprite:Alice')).ok, true);
    assert.equal(f.h.writes.length, 4, '失败动作已经释放，同一入口可以开始新操作');
    assert.equal(f.paints.length, 1);
});

test('开关关闭：缺 DNA 也保持外部原路径，零副 API 请求', async t => {
    const f = fixture(t, { enabled: false });
    const result = await f.service.generateCharacterSprite({ name: 'Alice' });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.deepEqual(f.order, ['plugin-write', 'plugin-paint']);
    assert.equal(f.h.writes.length, 0);
    assert.equal(f.bridge.sceneAssets.characterDna, undefined);
});

test('开关开启：先用副 API 建档并保存，再给 DBGen 参考；不调用内置出图', async t => {
    const f = fixture(t);
    const result = await f.service.generateCharacterSprite({ name: 'Alice' });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.deepEqual(f.order, ['dna', 'save', 'plugin-write', 'plugin-paint']);
    const saved = f.bridge.sceneAssets.characterDna.Alice;
    assert.equal(saved.version, 2);
    assert.equal(saved.identityInitialized, true);
    for (const view of ['full_body', 'half_body', 'portrait']) assert.ok(saved.views[view].subject);
    assert.equal(f.h.writes[0].input.outputs.format, 'sprite-data');
    assert.equal(f.h.writes[0].input.lore[0].name, 'Alice');
    assert.match(f.writes[0].description, /将所列设定逐项落实/);
    assert.ok(f.writes[0].description.includes(saved.views.half_body.subject));
    assert.doesNotMatch(f.writes[0].description, /<<dna:|promptTask|sprite-data/);
    assert.equal(f.h.wires.length, 0);
    await f.service.generateExpressionSet({ name: 'Alice', moods: ['喜悦'] });
    await f.service.generateCharacterAvatar({ name: 'Alice' });
    assert.equal(f.h.writes.length, 1, '后续立绘及头像复用已经保存的 DNA');
    assert.equal(f.paints.length, 3);
});

test('已有旧 DNA 不自动升级，三景别补缺时保留已有景别与显式空性格', async t => {
    const legacy = { identity: 'Alice, silver hair', defaultAppearance: 'blue coat', personality: '' };
    const old = fixture(t, { dna: legacy });
    assert.equal((await old.service.generateCharacterSprite({ name: 'Alice', dna: legacy })).ok, true);
    assert.equal(old.h.writes.length, 0);
    assert.deepEqual(old.bridge.sceneAssets.characterDna.Alice, legacy);
    const partial = { version: 2, identity: 'legacy identity', personality: '',
        views: { half_body: { subject: 'SAVED exact subject,', negative: 'SAVED negative' } } };
    const f = fixture(t, { dna: partial });
    const result = await f.service.generateCharacterSprite({ name: 'Alice', dna: partial });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.deepEqual(f.bridge.sceneAssets.characterDna.Alice.views.half_body, partial.views.half_body);
    assert.equal(f.bridge.sceneAssets.characterDna.Alice.personality, '');
    assert.equal(f.bridge.sceneAssets.characterDna.Alice.identity, partial.identity);
});

test('自动缺图先建档，同角色并发楼层只请求一次 DNA', async t => {
    const f = fixture(t);
    f.bridge.sceneAssets.characters = {};
    f.h.waitWriting();
    const one = f.service.processMessage(1, { manual: true });
    const two = f.service.processMessage(2, { manual: true });
    await writing(f.h);
    f.h.release();
    const results = await Promise.all([one, two]);
    for (const result of results) assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(f.h.writes.length, 1);
    assert.equal(f.order[0], 'dna');
    assert.equal(f.order[1], 'save');
    assert.equal(f.paints.length, 2);
});

test('同楼十个新角色的 DNA 只请求一次副 API，回复乱序仍逐人正确保存', async t => {
    const names = Array.from({ length: 10 }, (_, index) => `Actor${index}`);
    const f = fixture(t, { text: names.map(name => `[igs-char:${name}|平和|正在说话。]`).join('\n'),
        spriteCount: 10, reply: batchDnaReply });
    f.bridge.sceneAssets.characters = {};
    f.bridge.autoIllustration.assets.maxPerFloor = 16;
    let loreReads = 0;
    f.messageHost.readCharacterLore = async requested => {
        loreReads++;
        assert.deepEqual(requested, names);
        return requested.map(name => ({ name, description: `${name} source` }));
    };
    const result = await f.service.processMessage(1, { manual: true });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(f.h.writes.length, 1, '不得逐人请求，也不得按立绘出图批次拆分 DNA 请求');
    assert.equal(loreReads, 1);
    assert.deepEqual(f.h.writes[0].input.outputs.rows.map(row => row.characterKey), names);
    for (const name of names) assert.ok(f.bridge.sceneAssets.characterDna[name].views.half_body.subject.startsWith(`${name},`));
    assert.equal(f.paints.length, 10);
    assert.equal(f.order.filter(event => event === 'save').length, 10);
    assert.ok(f.order.lastIndexOf('save') < f.order.indexOf('plugin-write'), '整批资料验证和保存后才写外部生图提示词');
});

test('合并建档排除已有 DNA，主名与别名只生成一份资料', async t => {
    const f = fixture(t, { reply: batchDnaReply });
    f.bridge.sceneAssets.characterAliases = { Alice: ['A'] };
    f.bridge.sceneAssets.characterDna = { Bob: { identity: 'Bob legacy identity', personality: '' } };
    const old = structuredClone(f.bridge.sceneAssets.characterDna.Bob);
    const result = await f.service.prepareExternalSpriteDna.batch({ characters:
        ['Alice', 'A', 'Bob', 'Carol'].map(name => ({ name })) });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(f.h.writes.length, 1);
    assert.deepEqual(f.h.writes[0].input.outputs.rows.map(row => row.characterKey), ['Alice', 'Carol']);
    assert.deepEqual(f.bridge.sceneAssets.characterDna.Bob, old);
    assert.equal(f.bridge.sceneAssets.characterDna.A, undefined);
    assert.deepEqual(result.characters.find(row => row.name === 'A').dna, result.characters.find(row => row.name === 'Alice').dna);
    assert.equal(f.writes.length + f.paints.length, 0, '独立资料准备不调用外部写词或出图');
});

test('十人长设定完整进入同一次 DNA 请求，正文和所选前文不被字符截断', async t => {
    const names = Array.from({ length: 10 }, (_, index) => `Actor${index}`);
    const characters = names.map(name => ({ name, description: `${name}: ${'完整外貌设定。'.repeat(200)}${name}-END` }));
    const host = createIllustrationMessageHost({ SillyTavern: { getContext: () => ({ characters }) } });
    t.after(() => host.destroy());
    const body = '正文。'.repeat(2200) + names.map(name => `[igs-char:${name}|平和|正在说话。]`).join('\n');
    const previous = '前文。'.repeat(1000) + 'PREVIOUS-END';
    const f = fixture(t, { text: body, spriteCount: 10, reply: batchDnaReply });
    f.bridge.sceneAssets.characters = {};
    f.bridge.autoIllustration.assets.maxPerFloor = 16;
    f.messageHost.readCharacterLore = names => host.readCharacterLore(names, { includeWorldInfo: false });
    f.messageHost.readPreviousAiTexts = () => [previous];
    const result = await f.service.processMessage(1, { manual: true });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(f.h.writes.length, 1);
    const input = f.h.writes[0].input;
    assert.deepEqual(input.lore.map(row => row.name), names);
    for (const { name, description } of characters) assert.equal(input.lore.find(row => row.name === name).text, `角色卡：${description}`);
    assert.ok(input.numberedText.startsWith('正文。'.repeat(2200)));
    assert.ok(input.numberedText.includes('Actor9'));
    assert.equal(input.previousText, previous);
});

for (const cancel of ['abort', 'edited-floor']) test(`共享 DNA 的首个楼层取消不影响另一有效楼层-${cancel}`, async t => {
    const f = fixture(t, { reply: batchDnaReply });
    f.h.waitWriting();
    const controller = new AbortController();
    let current = true;
    const first = f.service.prepareExternalSpriteDna.batch({ characters: [{ name: 'Alice' }, { name: 'Bob' }],
        signal: controller.signal, shouldStart: () => current });
    await writing(f.h);
    const second = f.service.prepareExternalSpriteDna.batch({ characters: [{ name: 'Alice' }] });
    await setImmediate();
    if (cancel === 'abort') controller.abort(); else current = false;
    f.h.release();
    assert.equal((await first).ok, false);
    const shared = await second;
    assert.equal(shared.ok, true, JSON.stringify(shared));
    assert.equal(shared.shouldStart(), true);
    assert.equal(f.h.writes.length, 1);
    assert.deepEqual(Object.keys(f.bridge.sceneAssets.characterDna), ['Alice'], '仅取消楼层需要的 Bob 不写回');
    f.bridge.sceneAssets.characterDna.Alice.identity = 'manual-change';
    assert.equal(shared.shouldStart(), false, '共享完成后仍拒绝角色资料变化');
});

test('共享 DNA 保存交接时首个楼层取消，另一楼复用已保存资料而不误判为编辑冲突', async t => {
    const controller = new AbortController();
    const f = fixture(t, { reply: batchDnaReply, afterSave: () => controller.abort() });
    f.h.waitWriting();
    const first = f.service.prepareExternalSpriteDna({ name: 'Alice', signal: controller.signal });
    await writing(f.h);
    const second = f.service.prepareExternalSpriteDna({ name: 'Alice' });
    await setImmediate();
    f.h.release();
    assert.equal((await first).ok, false);
    const result = await second;
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.shouldStart(), true);
    assert.equal(f.h.writes.length, 1);
    assert.ok(f.bridge.sceneAssets.characterDna.Alice.views.half_body.subject);
});

test('仅有旧负面词或衣装不算身份，负面词占位允许补齐且主动清空仍受保护', async t => {
    for (const dna of [{ negative: 'bad eyes' }, { defaultAppearance: 'blue coat' }]) {
        const f = fixture(t, { dna });
        assert.equal((await f.service.generateCharacterSprite({ name: 'Alice' })).ok, true);
        assert.equal(f.h.writes.length, 1);
        for (const [key, value] of Object.entries(dna)) assert.equal(f.bridge.sceneAssets.characterDna.Alice[key], value);
    }
    let partial = editCharacterDnaField({}, 'views.portrait.negative', 'bad eyes');
    partial = editCharacterDnaField(partial, 'views.full_body.subject', 'Saved Alice identity,');
    const f = fixture(t, { dna: partial, reply(input) {
        const source = input.characterContext[0];
        return ['slotid: 1', 'character: Alice', 'personality: calm', 'outfit_name: 日常装',
            'outfit_description: wears a blue cotton dress', ...['full_body', 'half_body', 'portrait'].flatMap(view => [
                `dna_${view}: ${source.dna.views?.[view]?.subject || 'Alice, an adult woman with silver hair,'}`,
                `dna_uc_${view}: ${source.dna.views?.[view]?.negative || ''}`])].join('\n');
    } });
    const prepared = await f.service.prepareExternalSpriteDna({ name: 'Alice' });
    assert.equal(prepared.ok, true, JSON.stringify(prepared));
    assert.equal(prepared.dna.views.full_body.subject, partial.views.full_body.subject);
    assert.equal(prepared.dna.views.portrait.negative, 'bad eyes');
    const cleared = normalizeCharacterDna(editCharacterDnaField(prepared.dna, 'views.portrait.subject', ''));
    assert.deepEqual(cleared.clearedViews, ['portrait']);
    const locked = fixture(t, { dna: cleared });
    assert.equal((await locked.service.generateCharacterSprite({ name: 'Alice' })).reason, 'dna-manually-cleared');
    assert.equal(locked.h.writes.length + locked.paints.length, 0);
});

test('合并回复漏角色或任一角色在途改变，整批不保存、不继续外部出图', async t => {
    const names = ['Alice', 'Bob', 'Carol'];
    const text = names.map(name => `[igs-char:${name}|平和|正在说话。]`).join('\n');
    const bad = fixture(t, { text, reply: input => batchDnaReply(input).split('\n---\n').slice(0, 2).join('\n---\n') });
    bad.bridge.sceneAssets.characters = {};
    bad.bridge.autoIllustration.assets.maxPerFloor = 16;
    assert.equal((await bad.service.processMessage(1, { manual: true })).ok, false);
    assert.equal(bad.h.writes.length, 1);
    assert.equal(bad.bridge.sceneAssets.characterDna, undefined);
    assert.equal(bad.writes.length + bad.paints.length, 0);
    const f = fixture(t, { text, reply: batchDnaReply });
    f.bridge.sceneAssets.characters = {};
    f.bridge.autoIllustration.assets.maxPerFloor = 16;
    f.h.waitWriting();
    const pending = f.service.processMessage(1, { manual: true });
    await writing(f.h);
    f.bridge.sceneAssets.characters.Carol = { 默认: 'manual.png' };
    f.h.release();
    assert.equal((await pending).ok, false);
    assert.equal(f.bridge.sceneAssets.characterDna, undefined);
    assert.equal(f.writes.length + f.paints.length, 0);
});

test('重叠楼层共享在途角色，另一楼的新角色立即合并请求，不逐人排队', async t => {
    const f = fixture(t, { reply: batchDnaReply, spriteCount: 2 });
    f.bridge.sceneAssets.characters = {};
    f.bridge.autoIllustration.assets.maxPerFloor = 16;
    f.messageHost.readFloor = messageId => ({ chatId: 'chat-A', messageId, swipeId: 0, isAi: true, isLatest: true,
        text: (messageId === 1 ? ['Alice', 'Bob'] : ['Bob', 'Carol'])
            .map(name => `[igs-char:${name}|平和|正在说话。]`).join('\n') });
    f.h.waitWriting();
    const one = f.service.processMessage(1, { manual: true });
    const two = f.service.processMessage(2, { manual: true });
    await writing(f.h, 2);
    assert.deepEqual(f.h.writes.map(row => row.input.outputs.rows.map(character => character.characterKey)),
        [['Alice', 'Bob'], ['Carol']], 'Bob 共享第一次请求；Carol 在第一次返回之前即开始请求');
    f.h.release();
    for (const result of await Promise.all([one, two])) assert.equal(result.ok, true, JSON.stringify(result));
    assert.deepEqual(Object.keys(f.bridge.sceneAssets.characterDna).sort(), ['Alice', 'Bob', 'Carol']);
    assert.equal(f.paints.length, 4);
});

test('自动建档后外部出图失败，下次补图复用 DNA 并继续出图', async t => {
    let paintFailed = true;
    const f = fixture(t, { pluginFailure: () => paintFailed });
    f.bridge.sceneAssets.characters = {};
    assert.equal((await f.service.processMessage(1, { manual: true })).ok, false);
    assert.equal(f.h.writes.length, 1);
    assert.equal(f.paints.length, 1);
    paintFailed = false;
    const retry = await f.service.processMessage(1, { manual: true });
    assert.equal(retry.ok, true, JSON.stringify(retry));
    assert.equal(f.h.writes.length, 1, '重试不能重新付费建档');
    assert.equal(f.paints.length, 2);
});

test('补档失败或保存失败均停止外部写词和付费出图；手动清空不自动补回', async t => {
    const bad = fixture(t, { reply: () => 'invalid response' });
    const failed = await bad.service.generateCharacterSprite({ name: 'Alice' });
    assert.equal(failed.ok, false);
    assert.equal(bad.writes.length + bad.paints.length, 0);
    assert.equal(bad.bridge.sceneAssets.characterDna, undefined);
    const f = fixture(t);
    f.failSave();
    const result = await f.service.generateCharacterSprite({ name: 'Alice' });
    assert.equal(result.reason, 'dna-save-failed');
    assert.equal(f.writes.length + f.paints.length, 0);
    assert.equal(f.bridge.sceneAssets.characterDna, undefined);
    const cleared = fixture(t, { dna: { identity: '', identityInitialized: true, version: 2, views: {} } });
    assert.equal((await cleared.service.generateCharacterSprite({ name: 'Alice' })).reason, 'dna-manually-cleared');
    assert.equal(cleared.h.writes.length + cleared.writes.length + cleared.paints.length, 0);
    const clearedView = fixture(t, { dna: { version: 2, identityInitialized: true,
        views: { half_body: { subject: 'saved', negative: '' }, portrait: { subject: '', negative: '' } } } });
    assert.equal((await clearedView.service.generateCharacterSprite({ name: 'Alice' })).reason, 'dna-manually-cleared');
    assert.equal(clearedView.h.writes.length + clearedView.writes.length + clearedView.paints.length, 0);
});

test('补档在途切聊天或卡结束旧目标，迟到 DNA 不写入其它目标', { timeout: 5000 }, async t => {
    for (const mutate of [f => f.setChat('other'), f => f.setContext({ name2: 'Other card' })]) {
        const f = fixture(t);
        f.h.waitWriting();
        const request = f.service.generateCharacterSprite({ name: 'Alice' });
        await writing(f.h);
        mutate(f); f.h.release();
        assert.equal((await request).ok, false);
        assert.equal(f.bridge.sceneAssets.characterDna, undefined);
        assert.equal(f.writes.length + f.paints.length, 0);
    }
    const f = fixture(t);
    f.h.waitWriting();
    const pending = f.service.generateCharacterSprite({ name: 'Alice' });
    await writing(f.h);
    f.bridge.sceneAssets.characters.Alice = { 默认: 'new.png' };
    f.h.release();
    assert.equal((await pending).ok, true);
    assert.equal(f.bridge.sceneAssets.characters.Alice.默认, 'new.png');
});

test('DNA 保存之后在外部写词期间关开关，原任务继续出图', async t => {
    let f;
    f = fixture(t, { onPluginWrite() { f.bridge.imageApi.externalSpriteDna = false; } });
    assert.equal((await f.service.generateCharacterSprite({ name: 'Alice' })).ok, true);
    assert.equal(f.h.writes.length, 1);
    assert.equal(f.paints.length, 1);
});

test('补档期间开关往返切换，保留原 DNA 请求并继续原外部生成', async t => {
    const f = fixture(t);
    f.h.waitWriting();
    const pending = f.service.generateCharacterSprite({ name: 'Alice' });
    await writing(f.h);
    f.bridge.imageApi.externalSpriteDna = false; f.h.runtime.refresh();
    f.bridge.imageApi.externalSpriteDna = true; f.h.runtime.refresh();
    f.h.release();
    assert.equal((await pending).ok, true);
    assert.equal(f.bridge.sceneAssets.characterDna.Alice.version, 2);
    assert.deepEqual([f.h.writes.length, f.writes.length, f.paints.length], [1, 1, 1]);
});

test('智绘姬与柏宝绘也共用可选 DNA 建档，写词仍是普通外部请求', async t => {
    for (const mode of ['extension', 'baibai']) {
        const f = fixture(t);
        f.bridge.imageApi.mode = mode;
        const service = createAssetGenerationService({ llm: f.h.llm, store: f.store,
            getSettings: () => f.bridge, messageHost: f.messageHost,
            captureCharacterDnaTarget: name => f.dnaStore.capture(name), matte: async url => url,
            nai: { describe: () => ({ mode, via: mode }),
                async writePrompt(meta) {
                    assert.equal(meta.promptTask, undefined);
                    assert.equal(meta.outputs, undefined);
                    assert.ok(meta.characterContext[0].dna.views.half_body.subject);
                    return { ok: true, caption: structuredClone(caption) };
                },
                async generateCaption(meta) {
                    assert.deepEqual(meta.caption, caption);
                    return { ok: true, dataUrl: 'data:image/png;base64,AAAA' };
                } } });
        t.after(() => service.stop());
        const result = await service.generateCharacterSprite({ name: 'Alice' });
        assert.equal(result.ok, true, JSON.stringify(result));
        assert.equal(f.h.writes.length, 1);
        assert.equal(f.bridge.sceneAssets.characterDna.Alice.version, 2);
    }
});

test('DNA 存储只写角色所属库，冻结的全局和其他卡资料不受影响', t => {
    const f = fixture(t);
    f.bridge.sceneAssets.cards = { 'card:A': { characters: { Alice: {} } },
        'card:B': { characters: { Alice: {} }, characterDna: { Alice: { identity: 'other-card' } } } };
    f.setContext({ name2: 'A' });
    const original = structuredClone(f.bridge.sceneAssets);
    Object.freeze(f.bridge.sceneAssets.cards['card:B'].characterDna.Alice);
    Object.freeze(f.bridge.sceneAssets);
    const target = f.dnaStore.capture('Alice');
    assert.equal(target.save({ identity: 'saved-A' }).ok, true);
    assert.equal(f.bridge.sceneAssets.cards['card:A'].characterDna.Alice.identity, 'saved-A');
    assert.deepEqual(f.bridge.sceneAssets.cards['card:B'], original.cards['card:B']);
    assert.equal(f.bridge.sceneAssets.characterDna, undefined);
    assert.equal(target.isCurrent(), true);
});

function settingsFixture(f, confirmed, saveFails = false) {
    const questions = [], alerts = [];
    const state = { activeSettings: { draft: { bridge: normalizeBridgeConfig(structuredClone(f.bridge)), readerSettings: {} }, asyncState: {} } };
    const global = { localStorage: createMemoryStorage(), SillyTavern: { getContext: () => ({}) }, alert: text => alerts.push(text) };
    return { questions, alerts, state,
        ctx: { state, options: { global, generatedAssets: f.service }, rerenderSettings: () => ({ ok: true }),
            dialogs: { confirm: async text => { questions.push(text); return confirmed; }, prompt: async () => '', alert: async text => alerts.push(text) },
            persistSettingsDraft() {
                if (saveFails && state.activeSettings.draft.bridge.sceneAssets.characterDna?.Alice?.version === 2) return { ok: false };
                Object.assign(f.bridge, structuredClone(state.activeSettings.draft.bridge));
                return { ok: true };
            } } };
}

test('配置页生成：缺 DNA 先询问；取消零请求，确认则补齐保存后继续原生成动作', async t => {
    const cancelled = fixture(t), no = settingsFixture(cancelled, false);
    await handleSettingsAction('char-generate-sprite:Alice', no.ctx);
    assert.match(no.questions[0], /缺少可用.*DNA.*副 API/s);
    assert.equal(cancelled.h.writes.length + cancelled.writes.length + cancelled.paints.length, 0);
    const f = fixture(t), yes = settingsFixture(f, true);
    const result = await handleSettingsAction('char-generate-sprite:Alice', yes.ctx);
    assert.equal(result.ok, true, JSON.stringify({ result, alerts: yes.alerts }));
    assert.equal(f.h.writes.length, 1);
    assert.equal(f.paints.length, 1);
    assert.equal(yes.state.activeSettings.draft.bridge.sceneAssets.characterDna.Alice.version, 2);
    assert.equal(f.bridge.sceneAssets.characterDna.Alice.version, 2);
});

test('首次手动外貌要求先进入 DNA 请求，再写入外部立绘参考', async t => {
    const note = 'red hair and green eyes';
    const f = fixture(t, { reply(input) {
        assert.ok(input.description.includes(note), '首次 DNA 建档必须取得本次输入的外貌要求');
        return batchDnaReply(input).replaceAll('silver hair', 'red hair and green eyes');
    } });
    const ui = settingsFixture(f, true);
    ui.ctx.dialogs.prompt = async () => {
        assert.equal(f.h.writes.length, 0, '收集本次要求前不得生成 DNA');
        return note;
    };
    const result = await handleSettingsAction('char-generate-sprite:Alice', ui.ctx);
    assert.equal(result.ok, true, JSON.stringify({ result, alerts: ui.alerts }));
    assert.equal(f.h.writes.length, 1);
    assert.match(f.bridge.sceneAssets.characterDna.Alice.views.half_body.subject, /red hair and green eyes/);
    assert.ok(f.writes[0].description.includes(note));
    assert.equal(f.bridge.sceneAssets.characterSpriteNotes.Alice, note);
});

for (const enabled of [false, true]) test(`自动新立绘按首次正文衣装名入库，同名衣装按角色独立保存-DNA=${enabled}`, async t => {
    const f = fixture(t, { enabled, reply: batchDnaReply, spriteCount: 2,
        text: '[igs-char:Alice|平和|红裙|Alice 穿着红裙走进房间。]\n'
            + '[igs-char:Bob|平和|红裙|Bob 也穿着红裙。]\n'
            + '[igs-char:Alice|喜悦|蓝裙|Alice 稍后换上蓝裙。]' });
    f.bridge.sceneAssets.characters = {};
    f.bridge.sceneAssets.wardrobe = { 红裙: { prompt: 'another saved design' } };
    assert.equal((await f.service.processMessage(1, { manual: true })).ok, true);
    const ui = settingsFixture(f, true);
    const persist = ui.ctx.persistSettingsDraft;
    ui.ctx.persistSettingsDraft = () => {
        const bridge = ui.state.activeSettings.draft.bridge;
        bridge.sceneAssets = migrateSpriteSystem(bridge.sceneAssets).sceneAssets;
        return persist();
    };
    for (const name of ['Alice', 'Bob']) {
        const record = await f.service.readRecord(`chat-A|char|${name}`);
        assert.equal(record.outfitName, '红裙');
        ui.ctx.dialogs.prompt = async () => name;
        const adopted = await handleSettingsAction(`gen-temp-accept:${encodeURIComponent(record.key)}`, ui.ctx);
        assert.equal(adopted.ok, true, JSON.stringify({ adopted, alerts: ui.alerts }));
        const assets = f.bridge.sceneAssets;
        assert.deepEqual(Object.keys(assets.characterOutfits[name]), ['红裙']);
        assert.equal(assets.characterDefaultOutfits[name].outfitName, '红裙');
        assert.equal(assets.characterOutfits[name].红裙.moods.平和, `igs-gen:${record.imageId}`);
        assert.equal(assets.characterOutfits[name].红裙.base, undefined);
        assert.equal(assets.characterOutfits[name].红裙.wardrobe, `${name}·红裙`);
        assert.equal(assets.wardrobe[`${name}·红裙`].prompt, '');
        assert.equal(assets.characters[name].默认, undefined);
        assert.equal(resolveSpriteAsset(name, '', { sceneAssets: assets }).url, `igs-gen:${record.imageId}`);
    }
    assert.notEqual(f.bridge.sceneAssets.characterOutfits.Alice.红裙.moods.平和,
        f.bridge.sceneAssets.characterOutfits.Bob.红裙.moods.平和);
    assert.equal(f.bridge.sceneAssets.wardrobe.红裙.prompt, 'another saved design');
    assert.equal(f.writes.length, 1);
    assert.equal(f.paints.length, 2);
    assert.equal(f.h.writes.length, enabled ? 1 : 0);
    assert.equal((await f.service.processMessage(2, { manual: true })).reason, 'nothing-missing');
});

test('手动生成基础立绘写入平和，旧基础图保留原槽', async t => {
    const f = fixture(t, { enabled: false });
    f.bridge.sceneAssets.characterOutfits = { Alice: { 红裙: { words: [], moods: {}, base: 'old-base.png' } } };
    f.bridge.sceneAssets.characterDefaultOutfits = { Alice: { version: 1, outfitName: '红裙' } };
    const ui = settingsFixture(f, true);
    const result = await handleSettingsAction('char-generate-sprite:Alice', ui.ctx);
    assert.equal(result.ok, true, JSON.stringify({ result, alerts: ui.alerts }));
    const assets = f.bridge.sceneAssets, outfit = assets.characterOutfits.Alice.红裙;
    assert.equal(outfit.base, 'old-base.png');
    assert.ok(outfit.moods.平和.startsWith('igs-gen:'));
    assert.equal(assets.characters.Alice.默认, undefined);
    const image = await f.service.readStoredImage(outfit.moods.平和.slice('igs-gen:'.length));
    assert.ok(image.dataUrl);
    assert.equal(f.writes.length, 1);
    assert.equal(f.paints.length, 1);
    assert.equal(f.h.writes.length, 0);
});

test('迁移后丢图自动补全并采用到原衣装，不留下显示不到的新原装槽', async t => {
    const f = fixture(t);
    const outfit = 'Alice·初始衣装';
    f.bridge.sceneAssets = migrateSpriteSystem({ enabled: true, characters: { Alice: { 默认: 'igs-gen:lost' } } }).sceneAssets;
    assert.equal(resolveSpriteAsset('Alice', '', { sceneAssets: f.bridge.sceneAssets,
        isMissingImage: url => url === 'igs-gen:lost' }).needsGeneration, true);
    const result = await f.service.processMessage(1, { manual: true });
    assert.equal(result.ok, true, JSON.stringify(result));
    const record = await f.service.readRecord('chat-A|char|Alice');
    assert.equal(record.outfitName, outfit);
    const ui = settingsFixture(f, true);
    ui.ctx.dialogs.prompt = async () => 'Alice';
    const adopted = await handleSettingsAction(`gen-temp-accept:${encodeURIComponent(record.key)}`, ui.ctx);
    assert.equal(adopted.ok, true, JSON.stringify({ adopted, alerts: ui.alerts }));
    assert.equal(f.bridge.sceneAssets.characterOutfits.Alice[outfit].moods.平和, `igs-gen:${record.imageId}`);
    assert.equal(f.bridge.sceneAssets.characterOutfits.Alice[outfit].base, 'igs-gen:lost');
    assert.equal(f.bridge.sceneAssets.characters.Alice.默认, undefined);
    assert.equal(resolveSpriteAsset('Alice', '平和', { sceneAssets: f.bridge.sceneAssets }).url, `igs-gen:${record.imageId}`);
    assert.equal((await f.service.processMessage(2, { manual: true })).reason, 'nothing-missing');
    assert.equal(f.paints.length, 1);
});

test('命名衣装原图确认丢失时允许手动重新写词恢复，读取异常仍保留旧图', async t => {
    const f = fixture(t);
    f.bridge.sceneAssets = migrateSpriteSystem({ enabled: true, characters: { Alice: { 默认: 'igs-gen:lost' } } }).sceneAssets;
    const ui = settingsFixture(f, true);
    const result = await handleSettingsAction('char-generate-sprite:Alice', ui.ctx);
    assert.equal(result.ok, true, JSON.stringify({ result, alerts: ui.alerts }));
    assert.equal(f.paints.length, 1);
    assert.notEqual(f.bridge.sceneAssets.characterOutfits.Alice.初始衣装.base, 'igs-gen:lost');
    assert.deepEqual(Object.keys(f.bridge.sceneAssets.characterOutfits.Alice), ['初始衣装']);
    const unreadable = fixture(t);
    unreadable.bridge.sceneAssets = migrateSpriteSystem({ enabled: true, characters: { Alice: { 默认: 'igs-gen:old' } } }).sceneAssets;
    const failed = settingsFixture(unreadable, true);
    failed.ctx.options.generatedAssets = { ...unreadable.service, async readStoredImage() { throw new Error('temporary read error'); } };
    assert.equal((await handleSettingsAction('char-generate-sprite:Alice', failed.ctx)).ok, false);
    assert.equal(unreadable.bridge.sceneAssets.characterOutfits.Alice.初始衣装.base, 'igs-gen:old');
    assert.equal(unreadable.h.writes.length + unreadable.writes.length + unreadable.paints.length, 0);
});

test('剧情衣装先完成可选 DNA 建档，再冻结出图与采用基线，一次完成', async t => {
    const f = fixture(t, { reply: batchDnaReply });
    const service = createStoryOutfitService({ storage: createMemoryStorage(),
        assets: { ...f.service, writeWardrobePrompt: async () => ({ ok: true, prompt: 'wears a red raincoat' }) },
        getContext: () => ({ root: f.bridge.sceneAssets, scopeKey: '', floorKey: 'chat-A|1|0',
            sourceHash: 'source-1', messageId: 1, text: 'Alice 换上红雨衣。' }),
        commit(next, expected, guard) {
            assert.equal(guard(), true); assert.deepEqual(f.bridge.sceneAssets, expected);
            f.bridge.sceneAssets = structuredClone(next); return { ok: true };
        } });
    t.after(() => service.dispose());
    assert.equal(service.observe([{ character: 'Alice', unknownOutfit: '红雨衣' }]).ok, true);
    const row = service.list()[0];
    const result = await service.adopt(row.id, 'sprite');
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(f.h.writes.length, 1);
    assert.equal(f.writes.length, 1);
    assert.equal(f.paints.length, 1);
    assert.ok(f.bridge.sceneAssets.characterDna.Alice.views.half_body.subject);
    assert.ok(f.bridge.sceneAssets.characterOutfits.Alice.红雨衣.moods.平和);
    assert.equal(f.bridge.sceneAssets.characterDefaultOutfits.Alice.outfitName, '红雨衣');
});

test('配置页 DNA 保存失败回滚草稿，衣装/表情入口取消也不出图', async t => {
    const f = fixture(t), ui = settingsFixture(f, true, true);
    assert.equal((await handleSettingsAction('char-generate-sprite:Alice', ui.ctx)).ok, false);
    assert.equal(f.paints.length + f.writes.length, 0);
    assert.notEqual(ui.state.activeSettings.draft.bridge.sceneAssets.characterDna?.Alice?.version, 2);
    for (const action of ['outfit-expression-set:Alice:校服', 'char-expression-retry:Alice:喜悦', 'outfit-generate-nude:Alice:裸体']) {
        const external = fixture(t), cancelled = settingsFixture(external, false);
        await handleSettingsAction(action, cancelled.ctx);
        assert.match(cancelled.questions[0], /缺少可用.*DNA/s);
        assert.equal(external.h.writes.length + external.writes.length + external.paints.length, 0);
    }
});

for (const panelTiming of ['before', 'during', 'during-close', 'during-edit']) test(`实际 bootstrap：自动 DNA 保存同步草稿，关闭设置不丢失-${panelTiming}`, async t => {
    const f = fixture(t);
    if (panelTiming !== 'before') f.h.waitWriting();
    f.bridge.sceneAssets.characters = {};
    f.bridge.sceneAssets.cards = { 'card:Other': { characterDna: { Alice: { identity: 'other-card' } } } };
    const callbacks = [];
    const floor = { chatId: 'chat-A', messageId: 1, swipeId: 0, isAi: true, isLatest: true,
        text: `[igs-char:Alice|平和|${'现在开始讲述这段故事。'.repeat(12)}]` };
    const store = createMemoryGeneratedAssetStore();
    const context = { name2: 'Current', extensionPrompts: {}, getWorldInfoPrompt: async () => ({ worldInfoString: '' }) };
    const global = { localStorage: createMemoryStorage(), btoa, NaiDbGen: f.api,
        SillyTavern: { getContext: () => context } };
    const vn = bootstrapIGS({ global, config: f.bridge, secondaryLlm: f.h.llm,
        generatedAssetStore: store, illustrationStore: createMemoryIllustrationStore(), autoAttachMagicWand: false,
        alphaMatte: async url => url,
        illustrationMessageHost: { ...f.messageHost, readFloor: () => floor,
            onImageFloorReady(fn) { callbacks.push(fn); return () => {}; }, destroy() {},
            attachPromptStrip() {}, ensureMarkerRegexes: async () => ({ ok: true }) },
        hostAdapter: { getCurrentMessage: async () => null, typeAndSend: async () => ({ ok: true }) },
        fetch() { assert.fail('模拟测试不得请求真实网络'); } });
    t.after(() => vn.shutdown());
    let opened = panelTiming === 'before' ? vn.openSettings({ page: 'source' }) : null;
    for (const callback of callbacks) callback(1);
    if (panelTiming !== 'before') {
        await writing(f.h);
        opened = vn.openSettings({ page: 'source' });
        if (panelTiming === 'during-close') assert.equal(opened.controller.close().ok, true);
        if (panelTiming === 'during-edit') opened.controller.setValue(
            'bridge.sceneAssets.cards.card:Current.characterDna.Alice.identity', 'manual identity');
        f.h.release();
    }
    assert.match(opened.snapshot.html, /data-switch="bridge.imageApi.externalSpriteDna"/);
    assert.match(opened.snapshot.html, /外部生图前补齐角色 DNA/);
    let record;
    for (let i = 0; i < 200; i++) {
        record = await store.getFloor(floorKeyOf(floor));
        if (record?.status === 'done' || record?.status === 'failed') break;
        await setImmediate();
    }
    if (panelTiming === 'during-edit') {
        assert.equal(record?.status, 'failed', JSON.stringify(record));
        assert.equal(f.h.writes.length, 1);
        assert.equal(f.paints.length, 0);
        assert.equal(vn.getUnifiedSettings().bridge.sceneAssets.cards?.['card:Current']?.characterDna?.Alice, undefined);
        return;
    }
    assert.equal(record?.status, 'done', JSON.stringify(record));
    assert.equal(f.h.writes.length, 1);
    assert.equal(f.paints.length, 1);
    assert.equal(vn.getUnifiedSettings().bridge.sceneAssets.cards['card:Current'].characterDna.Alice.version, 2);
    if (panelTiming === 'during-close') opened = vn.openSettings({ page: 'source' });
    opened.controller.setValue('bridge.imageApi.externalSpriteDna', false);
    assert.equal(opened.controller.close().ok, true);
    const saved = vn.getUnifiedSettings().bridge;
    assert.equal(saved.imageApi.externalSpriteDna, false);
    assert.equal(saved.sceneAssets.cards['card:Current'].characterDna.Alice.version, 2);
    assert.equal(saved.sceneAssets.cards['card:Other'].characterDna.Alice.identity, 'other-card');
    const reopened = vn.openSettings({ page: 'source' });
    assert.equal(reopened.snapshot.draft.bridge.imageApi.externalSpriteDna, false);
    assert.equal(reopened.controller.close().ok, true);
});


test('无关资料并行保存：多人 DNA 一人改资料，其余角色建档并继续外部生成', async t => {
    const f = fixture(t, { text: '[igs-char:Alice|平和|你好。]\n[igs-char:Bob|平和|你好。]', spriteCount: 2, reply: batchDnaReply });
    f.bridge.sceneAssets.characters = {};
    f.h.waitWriting();
    const pending = f.service.processMessage(1, { manual: true });
    await writing(f.h);
    f.bridge.sceneAssets.characterDna = { Alice: { identity: 'user-saved silver hair' } };
    f.bridge.sceneAssets.characterOutfits = { Bob: { 雨衣: { wardrobe: 'raincoat', moods: {} } } };
    f.bridge.sceneAssets.wardrobe = { raincoat: { prompt: 'yellow raincoat' } };
    f.h.release();
    const result = await pending;
    assert.equal(result.ok, true, '资料保存后原批次继续完成');
    assert.equal(f.h.writes.length, 1, '所有缺资料角色仅一次副 API 请求');
    assert.equal(f.bridge.sceneAssets.characterDna.Alice.identity, 'user-saved silver hair');
    assert.equal(f.bridge.sceneAssets.characterDna.Bob.version, 2);
    assert.equal(f.bridge.sceneAssets.wardrobe.raincoat.prompt, 'yellow raincoat');
    assert.deepEqual([f.writes.length, f.paints.length], [1, 2]);
    assert.ok(f.writes[0].description.includes('Bob'));
});
