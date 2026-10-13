import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryGeneratedAssetStore, createIndexedDbGeneratedAssetStore } from '../src/media/generated-asset-store.js';
import { withTavernGeneratedAssetFiles } from '../src/media/tavern-image-files.js';
import { createAssetGenerationService } from '../src/generated-images/illustration/asset-generation-service.js';
import { createTransactionalIdb } from './helpers/transactional-idb.js';
import { provenanceFixture, characterViewsFixture, characterWriteFixture } from './helpers/prompt-provenance.js';
import { normalizeStoredPrompt, promptProvenance } from '../src/generated-images/generation-prompt.js';

const cap = (t) => ({ v4_prompt: { caption: { base_caption: t, char_captions: [] } }, v4_negative_prompt: { caption: { base_caption: 'lowres', char_captions: [] } } });
const flush = async () => { for (let i = 0; i < 10; i += 1) await new Promise((r) => setTimeout(r, 0)); };

test('gate:expression-prompt:background-migrate-does-not-overwrite-saved-prompt', async () => {
    // 读图时排下的「搬家」拿的是读到那一刻的记录；酒馆上传不可用时它原样写回，
    // 以前只比对图片数据，会把这之间保存的新提示词覆盖成旧的。
    const raw = createMemoryGeneratedAssetStore();
    await raw.putImage({ id: 'a', revision: 1, type: 'sprite', dataUrl: 'data:image/png;base64,QQ==', prompt: { positive: 'old', negative: '' } });
    // 酒馆上传接口慢且失败：搬家在上传期间被用户的保存插队，失败后拿着旧记录准备写回。
    const slowFailingUpload = () => new Promise((resolve) => setTimeout(() => resolve({ ok: false }), 40));
    const host = {
        setTimeout, clearTimeout,
        SillyTavern: { getContext: () => ({ getRequestHeaders: () => ({}) }) },
        fetch: slowFailingUpload,
    };
    const store = withTavernGeneratedAssetFiles(raw, host);
    const opened = await store.getImage('a');
    assert.equal(opened.prompt.positive, 'old');
    await raw.putImage({ ...opened, prompt: { positive: 'new words', negative: '' }, promptEdited: true });
    await new Promise((r) => setTimeout(r, 120));
    await flush();
    const after = await raw.getImage('a');
    assert.equal(after.prompt.positive, 'new words');
    assert.equal(after.promptEdited, true);
});

test('gate:expression-prompt:edited-prompt-is-kept-and-redrawn-as-is', async () => {
    const paints = [];
    const nai = {
        writeDbgenPrompt: async () => ({ ok: false }),
        generateDbgenCaption: async (meta) => { paints.push(meta); return { ok: true, dataUrl: 'data:image/png;base64,QQ==' }; },
    };
    const store = createMemoryGeneratedAssetStore();
    let seq = 0;
    const service = createAssetGenerationService({
        messageHost: { getChatId: () => 'chat', readFloor: () => null, readPreviousAiTexts: () => [], on: () => () => {} },
        llm: {}, nai, store,
        getSettings: () => ({ autoIllustration: {}, sceneAssets: {} }),
        newId: () => `r-${seq += 1}`,
        matte: async (dataUrl) => dataUrl,
    });
    await store.putImage({ id: 'img', revision: 1, dataUrl: 'data:image/png;base64,QQ==', prompt: { positive: 'smile', negative: '', caption: cap('smile, blue hair') } });
    assert.equal((await service.getImagePrompt('img')).edited, undefined);
    const saved = await service.saveImagePrompt('img', { positive: '', negative: '', caption: cap('my own words, silver hair') });
    assert.equal(saved.ok, true);
    const read = await service.getImagePrompt('img');
    assert.equal(read.edited, true);
    assert.equal(read.caption.v4_prompt.caption.base_caption, 'my own words, silver hair');

    const basePrompt = { positive: '1girl, red hoodie', negative: '', caption: cap('1girl, red hoodie') };
    // 用户改过的词：原样出图，不再补情绪 / 衣服词；新图继续记为改过。
    const exact = await service.generateExpressionImage({ name: '冬月', mood: '大笑', caption: read.caption, exact: true, basePrompt });
    assert.equal(paints[0].caption.v4_prompt.caption.base_caption, 'my own words, silver hair');
    const next = await service.getImagePrompt(exact.items[0].imageId);
    assert.equal(next.edited, true);
    // 没改过的词照旧硬合。
    await service.generateExpressionImage({ name: '冬月', mood: '大笑', caption: cap('plain'), basePrompt });
    assert.match(paints[1].caption.v4_prompt.caption.base_caption, /^laughing/);
});

test('gate:expression-prompt:exact-edits-bypass-current-dna-translation', async () => {
    let writes = 0;
    const paints = [];
    const service = createAssetGenerationService({
        messageHost: { getChatId: () => 'fixture', readFloor: () => null, readPreviousAiTexts: () => [], on: () => () => {} },
        llm: {}, nai: {
            async writeDbgenPrompt() { writes += 1; throw new Error('不应转译手改词'); },
            async generateDbgenCaption(meta) { paints.push(meta); return { ok: true, dataUrl: 'data:image/png;base64,QQ==' }; },
        }, store: createMemoryGeneratedAssetStore(),
        getSettings: () => ({ autoIllustration: {}, sceneAssets: {} }), newId: () => 'exact-dna',
        matte: async (src) => src,
    });
    const caption = cap('my own words, brown hair, coat');
    const result = await service.generateExpressionImage({ name: 'Alice', mood: '喜悦',
        caption, exact: true, dna: { identity: '银发' }, outfit: { name: '礼服', prompt: '白裙' } });
    assert.equal(result.items[0].ok, true);
    assert.equal(writes, 0);
    assert.deepEqual(paints[0].caption, caption);
    assert.equal(paints[0].replaceCharacterKeywords, false);
    assert.equal((await service.getImagePrompt(result.items[0].imageId)).edited, true);
});

const persistentService = (store) => createAssetGenerationService({
    store, messageHost: { getChatId: () => 'fixture' }, llm: {}, nai: {},
    getSettings: () => ({ autoIllustration: {}, sceneAssets: {} }),
});

test('gate:prompt-provenance:IDB 编辑跨连接回读，历史模板只作追溯', async () => {
    const indexedDB = createTransactionalIdb();
    const store = createIndexedDbGeneratedAssetStore({ indexedDB });
    const service = persistentService(store), fixture = provenanceFixture();
    await service.writeStoredImage({ id: 'dna', dataUrl: 'data:image/png;base64,QQ==',
        originalDataUrl: 'data:image/png;base64,QQ==', revision: 1,
        prompt: fixture.prompt, ...promptProvenance(fixture) });
    const opened = await service.getImagePrompt('dna');
    assert.equal(opened.revision, 1);
    const saved = await service.saveImagePrompt('dna', { caption: cap('edited words') }, opened.revision);
    assert.equal(saved.ok, true);
    const reopened = persistentService(createIndexedDbGeneratedAssetStore({ indexedDB }));
    const read = await reopened.readStoredImage('dna');
    assert.equal(read.revision, 2);
    assert.equal(read.promptEdited, true);
    assert.equal(read.prompt.captionMode, 'final');
    assert.equal(read.prompt.caption.v4_prompt.caption.base_caption, 'edited words');
    for (const field of ['promptRecipe', 'dnaSnapshot', 'sentPrompt']) {
        assert.deepEqual(read[field], fixture[field], field);
        assert.deepEqual(read.prompt[field], fixture[field], `prompt:${field}`);
    }
    const conflict = await service.saveImagePrompt('dna', { positive: 'stale' }, opened.revision);
    assert.equal(conflict.reason, 'stale-revision');
    assert.deepEqual(await reopened.readStoredImage('dna'), read);
    indexedDB.failNextPut(new Error('fixture-quota'));
    await assert.rejects(service.saveImagePrompt('dna', { positive: 'failed' }, 2), /fixture-quota/);
    assert.deepEqual(await reopened.readStoredImage('dna'), read);
});

test('gate:prompt-provenance:未知版本拒收，白名单不携带请求和凭据', () => {
    const fixture = provenanceFixture();
    assert.throws(() => normalizeStoredPrompt({ ...fixture.prompt, sentPrompt: { version: 9 } }), /PROMPT_PROVENANCE_INVALID/);
    const cleaned = promptProvenance({ ...fixture, apiKey: 'fixture-secret',
        sentPrompt: { ...fixture.sentPrompt, parameters: { image: 'base64-secret' }, apiKey: 'fixture-secret' } });
    assert.deepEqual(cleaned.sentPrompt, fixture.sentPrompt);
    assert.equal(JSON.stringify(cleaned).includes('secret'), false);
});


function assetFilesHost() {
    const files = new Map();
    const host = { setTimeout, clearTimeout,
        SillyTavern: { getContext: () => ({ getRequestHeaders: () => ({}) }) },
        FileReader: class { readAsDataURL(blob) { blob.text().then((data) => {
            this.result = `data:image/png;base64,${data}`; this.onload();
        }); } },
        async fetch(url, options = {}) {
            const body = options.body && JSON.parse(options.body);
            if (url === '/api/images/upload') {
                const path = `user/images/igs-assets/${body.filename}.png`;
                files.set(path, body.image);
                return { ok: true, json: async () => ({ path }) };
            }
            if (url === '/api/images/delete') { files.delete(body.path); return { ok: true }; }
            if (String(url).startsWith('/user/images/')) return {
                ok: files.has(url.slice(1)), blob: async () => new Blob([files.get(url.slice(1))]),
            };
            return { ok: false, status: 404 };
        },
    };
    return { host, files };
}

test('gate:prompt-provenance:图片 offload 后权威 IDB 回读保留来源，编辑不回写像素', async () => {
    const indexedDB = createTransactionalIdb(), f = assetFilesHost(), fixture = provenanceFixture();
    const raw = createIndexedDbGeneratedAssetStore({ indexedDB });
    const service = persistentService(withTavernGeneratedAssetFiles(raw, f.host));
    assert.equal((await service.writeStoredImage({ id: 'offload', revision: 1, type: 'sprite',
        dataUrl: 'data:image/png;base64,QQ==', originalDataUrl: 'data:image/png;base64,QQ==',
        prompt: fixture.prompt, ...promptProvenance(fixture) })).ok, true);
    const stored = await raw.getImage('offload');
    assert.match(stored.dataUrl, /^user\/images\/igs-assets\//);
    const reopened = persistentService(withTavernGeneratedAssetFiles(createIndexedDbGeneratedAssetStore({ indexedDB }), f.host));
    const read = await reopened.getImagePrompt('offload');
    assert.equal((await reopened.saveImagePrompt('offload', { caption: cap('changed') }, read.revision)).ok, true);
    const after = await raw.getImage('offload');
    assert.equal(after.dataUrl, stored.dataUrl);
    assert.equal(after.originalDataUrl, stored.originalDataUrl);
    for (const field of ['promptRecipe', 'dnaSnapshot', 'sentPrompt']) assert.deepEqual(after[field], fixture[field]);
    assert.equal((await reopened.readStoredImage('offload')).dataUrl, 'data:image/png;base64,QQ==');
});

test('gate:prompt-provenance:搬家上传期间的编辑使旧迁移事务失效', async () => {
    const indexedDB = createTransactionalIdb(), f = assetFilesHost(), fixture = provenanceFixture();
    const raw = createIndexedDbGeneratedAssetStore({ indexedDB });
    await raw.putImage({ id: 'race', revision: 1, dataUrl: 'data:image/png;base64,QQ==',
        prompt: fixture.prompt, ...promptProvenance(fixture) });
    let release, started;
    const waiting = new Promise((resolve) => { started = resolve; });
    const fetch = f.host.fetch;
    f.host.fetch = async (url, options) => {
        if (url === '/api/images/upload') { started(); await new Promise((resolve) => { release = resolve; }); }
        return fetch(url, options);
    };
    const service = persistentService(withTavernGeneratedAssetFiles(raw, f.host));
    const read = await service.getImagePrompt('race');
    await waiting;
    assert.equal((await service.saveImagePrompt('race', { positive: 'new words' }, read.revision)).ok, true);
    release(); await flush();
    const after = await createIndexedDbGeneratedAssetStore({ indexedDB }).getImage('race');
    assert.equal(after.prompt.positive, 'new words');
    assert.equal(after.captionMode, 'final');
    assert.equal(after.revision, 2);
    assert.deepEqual(after.sentPrompt, fixture.sentPrompt);
});


test('gate:prompt-provenance:表情备注随角色移动，借用和复制保留三阶段来源', async () => {
    const { normalizeGeneratedLibrary, setGeneratedExpressionNote } = await import('../src/scene/asset-match.js');
    const { moveLibraryEntry, effectiveSceneAssets, normalizeAssetCards } = await import('../src/scene/asset-scope.js');
    const fixture = provenanceFixture();
    const note = { ...fixture.prompt, edited: true, error: '' };
    const saved = setGeneratedExpressionNote({ characters: { Alice: { 默认: 'igs-gen:dna' } } }, 'Alice', '默认', note);
    assert.equal(saved.ok, true);
    const root = { cards: { 'card:A': { characters: { Alice: { 默认: 'igs-gen:dna' } },
        generated: saved.library }, 'card:B': {} } };
    normalizeAssetCards(root);
    const borrowed = effectiveSceneAssets(root, 'card:B');
    assert.deepEqual(borrowed.generated.expressionNotes.Alice.默认, note);
    assert.equal(moveLibraryEntry(root, 'card:A', 'card:B', 'characters', 'Alice', { copy: true }).ok, true);
    const copied = normalizeGeneratedLibrary(root.cards['card:B'].generated).expressionNotes.Alice.默认;
    assert.deepEqual(copied, note);
    copied.promptRecipe.caption.v4_prompt.caption.base_caption = 'copy-only';
    assert.equal(root.cards['card:A'].generated.expressionNotes.Alice.默认.promptRecipe.caption.v4_prompt.caption.base_caption, 'quiet studio');
    assert.equal(moveLibraryEntry(root, 'card:A', 'card:C', 'characters', 'Alice').ok, true);
    assert.deepEqual(root.cards['card:C'].generated.expressionNotes.Alice.默认, note);
    assert.equal(root.cards['card:A'].generated.expressionNotes.Alice, undefined);
});

async function expressionTemplateHarness(indexedDB = createTransactionalIdb(), options = {}) {
    const { createImageBackend } = await import('../src/generated-images/image-backend.js');
    const { buildPipeline } = await import('../../../nai-dbgen/tests/application/_fakes.js');
    const pipeline = buildPipeline();
    pipeline.patchSettings({ naiParams: { ...pipeline.settings.naiParams, model: 'nai-diffusion-5-full' } });
    const writes = [], paints = [];
    let afterWrite = () => {}, afterPaint = () => {}, sequence = 0;
    const backend = createImageBackend({ global: { NaiDbGen: {
        getPromptCapabilities: () => ({ finalCaption: 1, promptSnapshot: 1 }),
        async generateSinglePrompt(req) {
            writes.push(structuredClone({ ...req, signal: undefined }));
            const written = options.writePrompt ? await options.writePrompt(req, pipeline) : null;
            if (written && !written.ok) return written;
            const value = written ? written.value : characterWriteFixture(req, {
                action: 'wears a white dress and smiles.', outfitDescription: 'wears a white dress' });
            options.transformWritten?.(value, req);
            value.captions.reverse();
            afterWrite();
            return { ok: true, value };
        },
        async generate(req) {
            paints.push(req);
            const result = await pipeline.imageGen.generate(req);
            afterPaint();
            return result;
        },
    } }, getBridge: () => ({ imageApi: { mode: 'dbgen' } }) });
    const open = () => createAssetGenerationService({ nai: backend,
        store: createIndexedDbGeneratedAssetStore({ indexedDB }),
        messageHost: options.messageHost || { getChatId: () => 'fixture' }, llm: {},
        getSettings: options.getSettings || (() => ({ autoIllustration: {}, sceneAssets: {} })),
        report: () => {},
        newId: () => `expression-template-${++sequence}`, matte: async (url) => url });
    return { service: open(), open, indexedDB, writes, paints, pipeline,
        afterWrite(fn) { afterWrite = fn; }, afterPaint(fn) { afterPaint = fn; } };
}

// 经过真实 IGS Adapter、DBGen 定稿装配和 IDB adapter，不用入口 mock 代替回读。
test('gate:dna-expression:当前 DNA 重画与手改定稿跨连接回读', async () => {
    const h = await expressionTemplateHarness();
    const dna = { version: 2, views: characterViewsFixture(), defaultAppearance: 'red hoodie' };
    const outfit = { name: '礼服', prompt: 'wears a white dress', words: ['white dress'] };
    const before = structuredClone(dna);
    try {
        const first = await h.service.generateExpressionSet({ name: 'Alice', dna, outfit, moods: ['喜悦', '愤怒'] });
        assert.equal(first.ok, true, first.error);
        assert.deepEqual(first.items.map((i) => i.ok), [true, true]);
        assert.equal(h.writes.length, 1);
        assert.equal(h.paints.length, 2);
        assert.equal(h.writes[0].promptTask.purpose, 'derived');
        assert.deepEqual(h.writes[0].characterContext[0].outfit.words, ['white dress']);
        assert.equal(h.paints[0].seed, h.paints[1].seed);
        assert.deepEqual(dna, before);
        const reopened = h.open();
        const original = await reopened.readStoredImage(first.items[0].imageId);
        const saved = await reopened.getImagePrompt(original.id);
        assert.equal(saved.dnaSnapshot.characters[0].source, 'saved');
        assert.equal(saved.dnaSnapshot.characters[0].framing, 'half_body');
        assert.equal(original.dnaCandidates, undefined);
        assert.deepEqual(saved.sentPrompt.caption.v4_prompt.caption,
            h.pipeline.naiCalls[0].payload.parameters.v4_prompt.caption);
        dna.views.half_body.subject = 'Alice, an adult woman with black hair and blue eyes,';
        const redraw = await reopened.generateExpressionImage({ name: 'Alice', mood: '喜悦', dna, outfit,
            caption: saved.caption, promptRecipe: saved.promptRecipe, characterMeta: saved.characterMeta, history: saved });
        assert.equal(redraw.items[0].ok, true, redraw.items[0].error);
        assert.equal(h.writes.length, 1, '模板重画不增加写词');
        assert.equal(h.paints[2].caption.v4_prompt.caption.char_captions[0].char_caption,
            dna.views.half_body.subject + ' wears a white dress and smiles.');
        assert.deepEqual(await reopened.readStoredImage(original.id), original, '历史图片及身份快照不变');
        const current = await h.open().getImagePrompt(redraw.items[0].imageId);
        assert.equal(current.dnaSnapshot.characters[0].subject, dna.views.half_body.subject);
        assert.equal((await reopened.saveImagePrompt(original.id, { caption: cap('my own final words') }, saved.revision)).ok, true);
        const edited = await h.open().getImagePrompt(original.id);
        const final = await reopened.generateExpressionImage({ name: 'Alice', mood: '喜悦', dna: {},
            caption: edited.caption, exact: true, promptRecipe: edited.promptRecipe,
            characterMeta: edited.characterMeta, history: edited });
        assert.equal(final.items[0].ok, true, final.items[0].error);
        assert.deepEqual(h.paints[3].caption, edited.caption);
        assert.equal(h.writes.length, 1);
        const finalRead = await h.open().getImagePrompt(final.items[0].imageId);
        assert.equal(finalRead.edited, true);
        assert.deepEqual(finalRead.promptRecipe, edited.promptRecipe, '历史模板仅保留作追溯');
    } finally { h.pipeline.imageGen.dispose(); }
});

test('gate:dna-expression:写词后取消保留模板，续画当前 DNA 且不重写', async () => {
    const { setGeneratedExpressionNote, normalizeGeneratedLibrary } = await import('../src/scene/asset-match.js');
    const { pendingExpressionCaptions } = await import('../src/visual/igs-ui/settings-outfit-fields.js');
    const h = await expressionTemplateHarness(), controller = new AbortController();
    const dna = { version: 2, views: characterViewsFixture() };
    h.afterWrite(() => controller.abort());
    try {
        const stopped = await h.service.generateExpressionSet({ name: 'Alice', dna,
            moods: ['喜悦', '愤怒'], signal: controller.signal });
        assert.equal(stopped.stopped, true);
        assert.equal(h.writes.length, 1);
        assert.equal(h.paints.length, 0);
        let library = { characters: { Alice: { 默认: 'old.png' } } };
        for (const item of stopped.items) {
            assert.equal(item.error, '已停止');
            assert.ok(item.promptRecipe && item.characterMeta && item.promptTask);
            library = setGeneratedExpressionNote(library, 'Alice', item.mood, item).library;
        }
        const recovered = normalizeGeneratedLibrary(JSON.parse(JSON.stringify(library)));
        const pending = pendingExpressionCaptions(recovered.expressionNotes.Alice, {});
        assert.equal(pending.length, 2);
        dna.views.half_body.subject = 'Alice, an adult woman with black hair,';
        const resumed = await h.open().paintExpressionCaptions({ name: 'Alice', dna, items: pending });
        assert.deepEqual(resumed.items.map((i) => i.ok), [true, true]);
        assert.equal(h.writes.length, 1);
        assert.equal(h.paints.length, 2);
        for (const item of resumed.items) {
            const stored = await h.open().getImagePrompt(item.imageId);
            assert.equal(stored.dnaSnapshot.characters[0].subject, dna.views.half_body.subject);
            assert.deepEqual(stored.promptRecipe, pending.find((p) => p.mood === item.mood).promptRecipe);
            assert.equal(stored.edited, undefined);
        }
    } finally { h.pipeline.imageGen.dispose(); }
});

test('gate:dna-sprite:当前 DNA 重画与手改定稿采用不复用旧候选', async () => {
    const { handleSettingsAction } = await import('../src/visual/igs-ui/settings-actions.js');
    const { prepareSpriteIdentityAdoption } = await import('../src/scene/character-identity.js');
    const h = await expressionTemplateHarness();
    try {
        const first = await h.service.generateCharacterSprite({ name: 'Alice', dna: {} });
        assert.equal(first.ok, true, first.error);
        const original = await h.open().readStoredImage(first.imageId);
        const adopted = prepareSpriteIdentityAdoption({}, 'Alice', original.id, original);
        assert.equal(adopted.ok, true, adopted.error);
        const dna = structuredClone(adopted.patch.characterDna.Alice);
        dna.views.half_body.subject = 'Alice, an adult woman with black hair,';
        const saved = await h.open().getImagePrompt(original.id);
        const redraw = await h.service.generateCharacterSprite({ name: 'Alice', dna,
            caption: saved.caption, promptRecipe: saved.promptRecipe, characterMeta: saved.characterMeta, history: saved });
        assert.equal(redraw.ok, true, redraw.error);
        assert.equal(h.writes.length, 1, '普通重画不增加写词');
        assert.equal(h.paints[1].caption.v4_prompt.caption.char_captions[0].char_caption,
            dna.views.half_body.subject + ' wears a white dress and smiles.');
        const current = await h.open().readStoredImage(redraw.imageId);
        assert.equal(current.dnaCandidates, undefined);
        assert.equal(current.dnaSnapshot.characters[0].source, 'saved');
        assert.deepEqual(await h.open().readStoredImage(original.id), original);

        const words = cap('My final composition, untouched.');
        assert.equal((await h.service.saveImagePrompt(original.id, { caption: words }, saved.revision)).ok, true);
        const edited = await h.open().getImagePrompt(original.id);
        const assets = { characters: { Alice: { 默认: `igs-gen:${original.id}` } },
            characterDna: {}, characterAliases: {}, characterOutfits: {}, wardrobe: {} };
        const before = structuredClone(assets);
        const result = await handleSettingsAction('char-generate-sprite:Alice', {
            state: { activeSettings: { draft: { bridge: { sceneAssets: assets } }, asyncState: {} } },
            options: { global: { alert() {} }, generatedAssets: h.service },
            persistSettingsDraft: () => ({ ok: true }), rerenderSettings: () => ({ ok: true }),
        });
        assert.equal(result.ok, true, result.error);
        assert.deepEqual(h.paints[2].caption, edited.caption);
        assert.equal(h.writes.length, 1, '手改定稿不写词、不依赖 DNA');
        for (const field of ['characterDna', 'characterOutfits', 'wardrobe']) assert.deepEqual(assets[field], before[field]);
        const finalId = assets.characters.Alice.默认.slice('igs-gen:'.length);
        const final = await h.open().readStoredImage(finalId);
        assert.equal(final.promptEdited, true);
        assert.equal(final.dnaCandidates, undefined);
        assert.deepEqual(final.promptRecipe, edited.promptRecipe, '历史 recipe 仅作追溯');
        const legacyFinal = { imageId: 'final-only', edited: true, characterMeta: {
            version: 1, characters: [{ characterKey: 'Alice', identityAnchor: 'Must not become DNA.' }] } };
        assert.deepEqual(prepareSpriteIdentityAdoption(before, 'Alice', legacyFinal.imageId, legacyFinal).patch.characterDna,
            before.characterDna, '无历史 recipe 的手改定稿也不得走旧身份建档');
    } finally { h.pipeline.imageGen.dispose(); }
});
test('gate:dna-adoption:三个全新角色空衣装库首次采用，状态失败恢复并可重试', async () => {
    const { handleSettingsAction } = await import('../src/visual/igs-ui/settings-actions.js');
    const floor = { chatId: 'fixture', messageId: 3, swipeId: 0, isAi: true, isLatest: true,
        text: '[igs-char:侯方域|平静|你好。]\n[igs-char:李香君|平静|早上好。]\n[igs-char:田仰|平静|请坐。]' };
    const assets = { enabled: true, characters: {}, scenes: {}, characterAliases: {},
        characterDna: {}, characterOutfits: {}, wardrobe: {} };
    const h = await expressionTemplateHarness(createTransactionalIdb(), {
        messageHost: { getChatId: () => 'fixture', readFloor: () => floor, readPreviousAiTexts: () => [] },
        getSettings: () => ({ autoIllustration: { assets: { spriteEnabled: true, maxPerFloor: 3 } }, sceneAssets: assets }),
        transformWritten(value) {
            for (const entry of value.captions) for (const view of Object.values(entry.dnaCandidates?.characters[0]?.views || {}))
                view.subject = `${entry.characterMeta.characters[0].characterKey}, an adult with silver hair,`;
        },
    });
    try {
        assert.equal((await h.service.processMessage(3, { manual: true })).ok, true);
        assert.deepEqual(assets.characterDna, {}, '生成图片不提交身份');
        assert.deepEqual(assets.characters, {}, '生成后、首次入库前不登记角色');
        assert.deepEqual(assets.characterOutfits, {}, '生成后、首次入库前没有默认衣装');
        assert.deepEqual(assets.wardrobe, {}, '未采用的候选衣装不进入衣柜');
        const raw = createIndexedDbGeneratedAssetStore({ indexedDB: h.indexedDB });
        const records = await raw.getAssetsByChat('fixture');
        assert.equal(records.length, 3);
        for (const record of records) {
            const frozen = await h.open().readStoredImage(record.imageId);
            assert.deepEqual(frozen.outfitContext[0].outfits, [], '本张图片冻结的是空的已保存衣装基线');
            assert.equal(frozen.outfitSnapshot.characters[0].source, 'candidate', '本次衣装只是候选');
            assert.equal(assets.characterOutfits[record.name], undefined, '其他角色采用不登记本角色衣装');
            const before = structuredClone(assets), saves = [];
            let failStatus = record.name === '李香君', reads = 0;
            const ctx = {
                state: { activeSettings: { draft: { bridge: { sceneAssets: assets } }, asyncState: {} } },
                options: { global: { alert() {} }, generatedAssets: { ...h.service,
                    async readStoredImage(id) { reads++; assert.deepEqual(assets, before); return h.open().readStoredImage(id); },
                } },
                dialogs: { prompt: async () => record.name, alert() {} },
                persistSettingsDraft() {
                    saves.push(structuredClone(assets));
                    if (failStatus && saves.length === 1) h.indexedDB.failNextPut(new Error('fixture-status-save'));
                    return { ok: true };
                }, rerenderSettings: () => ({ ok: true }),
            };
            const result = await handleSettingsAction(`gen-temp-accept:${encodeURIComponent(record.key)}`, ctx);
            assert.equal(reads, 1);
            if (failStatus) {
                assert.equal(result.reason, 'generated-asset-status-failed');
                assert.deepEqual(assets, before);
                assert.deepEqual(saves[1], before, '失败后第二次保存恢复原设置');
                assert.equal(h.service.getRecord(record.key).status, record.status, '内存仍待采用');
                assert.equal((await raw.getAssetsByChat('fixture')).find((r) => r.key === record.key).status, record.status);
                failStatus = false;
                assert.equal((await handleSettingsAction(`gen-temp-accept:${encodeURIComponent(record.key)}`, ctx)).ok, true);
            } else assert.equal(result.ok, true, result.error);
            const image = await h.open().readStoredImage(record.imageId);
            const clothing = image.outfitSnapshot.characters[0];
            assert.equal(assets.characterDna[record.name].defaultAppearance, clothing.description, '成功采用才将默认服装写入 DNA');
            assert.deepEqual(assets.characterOutfits, {}, '默认服装不新建外部服装页签');
            assert.deepEqual(assets.wardrobe, {}, '默认服装不登记衣柜');
            assert.deepEqual(assets.characterDna[record.name].views, image.dnaCandidates.characters[0].views);
            assert.equal(assets.characterDna[record.name].identitySource, image.id);
            assert.equal(h.service.getRecord(record.key).status, 'library');
            assert.equal((await raw.getAssetsByChat('fixture')).find((r) => r.key === record.key).status, 'library');
            assert.equal((await h.service.setStatus(record.key, 'library', { imageId: record.imageId, status: record.status })).reason,
                'DNA_ADOPTION_CONFLICT', '重复旧回执不能再次提交');
        }
        assert.equal(h.writes.length, 1); assert.equal(h.paints.length, 3);
        const name = records[0].name, dna = assets.characterDna[name];
        const repeated = await h.service.generateExpressionSet({ name, dna, moods: ['喜悦'] });
        assert.equal(repeated.ok, true, repeated.error);
        assert.equal(repeated.items[0].ok, true, repeated.items[0].error);
        const stored = await h.open().readStoredImage(repeated.items[0].imageId);
        assert.equal(stored.outfitSnapshot.characters[0].source, 'saved');
        assert.equal(stored.outfitSnapshot.characters[0].name, '');
        assert.equal(stored.outfitSnapshot.characters[0].description, dna.defaultAppearance);
        assert.equal(h.paints.at(-1).caption.v4_prompt.caption.char_captions[0].char_caption,
            dna.views.half_body.subject + ' ' + dna.defaultAppearance + ' and smiles.');
        assert.deepEqual(assets.characterOutfits, {}); assert.deepEqual(assets.wardrobe, {});
    } finally { h.pipeline.imageGen.dispose(); }
});
test('gate:dna-expression:缺身份景别形态零请求，批次不混用中途修改的 DNA', async () => {
    const h = await expressionTemplateHarness();
    const dna = { version: 2, views: characterViewsFixture() };
    try {
        for (const [profile, outfit, reason] of [
            [{}, undefined, 'DNA_MISSING'],
            [{ identity: '银发' }, undefined, 'DNA_VIEW_MISSING'],
            [dna, { form: { gender: 'female' } }, 'DNA_VIEW_INVALID'],
        ]) {
            const rejected = await h.service.generateExpressionSet({ name: 'Alice', dna: profile, outfit, moods: ['喜悦'] });
            assert.equal(rejected.reason, reason);
        }
        assert.equal(h.writes.length, 0);
        assert.equal(h.paints.length, 0);
        const subject = dna.views.half_body.subject;
        h.afterPaint(() => { dna.views.half_body.subject = 'Alice, an adult woman with black hair,'; });
        const result = await h.service.generateExpressionSet({ name: 'Alice', dna, moods: ['喜悦', '愤怒'] });
        assert.deepEqual(result.items.map((i) => i.ok), [true, true]);
        for (const req of h.paints) assert.equal(req.caption.v4_prompt.caption.char_captions[0].char_caption,
            subject + ' wears a white dress and smiles.');
        assert.equal(h.writes.length, 1);
        assert.equal(h.paints.length, 2);
    } finally { h.pipeline.imageGen.dispose(); }
});

test('gate:dna-adoption:候选跨连接回读，采用才登记且身份变化拒收', async () => {
    const { prepareSpriteIdentityAdoption } = await import('../src/scene/character-identity.js');
    const h = await expressionTemplateHarness();
    const assets = { characters: { Alice: { 默认: 'old.png' } }, characterDna: {} };
    const before = structuredClone(assets);
    try {
        const generated = await h.service.generateCharacterSprite({ name: 'Alice', dna: {} });
        assert.equal(generated.ok, true, generated.error);
        assert.deepEqual(assets, before, '生成不登记身份');
        const record = await h.open().readStoredImage(generated.imageId);
        assert.deepEqual(record.dnaCandidates, generated.dnaCandidates);
        assert.equal(record.promptTask.purpose, 'sprite');
        assert.equal(record.promptTask.characters.length, 1);
        assert.equal(record.identityContext.length, 1);
        assert.equal(record.dnaSnapshot.characters[0].source, 'candidate');
        const adopted = prepareSpriteIdentityAdoption(assets, 'Alice', record.id, record, { hadDefault: true });
        assert.equal(adopted.ok, true, adopted.error);
        assert.deepEqual(assets, before, '准备采用不修改原资料');
        assert.deepEqual(adopted.patch.characterDna.Alice.views, record.dnaCandidates.characters[0].views);
        assert.equal(adopted.patch.characterDna.Alice.identitySource, record.id);
        assert.equal(adopted.patch.characterDna.Alice.identityInitialized, true);
        assert.equal(adopted.patch.characterDna.Alice.identity, '', '不从动态词猜旧身份');
        assert.equal(adopted.patch.characterDna.Alice.defaultAppearance, record.outfitSnapshot.characters[0].description);
        assert.equal(adopted.patch.characterOutfits, undefined);
        assert.equal(adopted.patch.wardrobe, undefined);
        for (const profile of [{ identity: 'manual', identityInitialized: true },
            { identity: '', identityInitialized: true }, adopted.patch.characterDna.Alice]) {
            assert.equal(prepareSpriteIdentityAdoption({ characterDna: { Alice: profile } }, 'Alice', record.id, record).reason,
                'DNA_ADOPTION_CONFLICT');
        }
        const invalid = structuredClone(record); invalid.promptTask.purpose = 'cg';
        assert.equal(prepareSpriteIdentityAdoption(assets, 'Alice', record.id, invalid).ok, false);
        assert.equal(prepareSpriteIdentityAdoption(assets, 'Alice', record.id, { ...record, promptEdited: true }).ok, false);
        assert.equal(prepareSpriteIdentityAdoption(assets, 'Bob', record.id, record).ok, false);
        assert.equal(h.writes.length, 1);
        assert.equal(h.paints.length, 1);
    } finally { h.pipeline.imageGen.dispose(); }
});

test('gate:dna-adoption:quota 降级保留候选与采用证据', async () => {
    const h = await expressionTemplateHarness();
    try {
        h.indexedDB.failNextPut(Object.assign(new Error('fixture-quota'), { name: 'QuotaExceededError' }));
        const result = await h.service.generateCharacterSprite({ name: 'Alice', dna: {} });
        assert.equal(result.ok, true, result.error);
        const read = await h.open().readStoredImage(result.imageId);
        assert.equal(read.originalDataUrl, '');
        for (const key of ['dnaCandidates', 'identityContext', 'promptTask', 'slotId', 'promptRecipe', 'dnaSnapshot', 'sentPrompt'])
            assert.deepEqual(read[key], result[key], key);
        const { prepareSpriteIdentityAdoption } = await import('../src/scene/character-identity.js');
        assert.equal(prepareSpriteIdentityAdoption({}, 'Alice', read.id, read).ok, true);
    } finally { h.pipeline.imageGen.dispose(); }
});

test('gate:dna-adoption:批量 slot 乱序回复与单图采用证据跨连接回读', async () => {
    const { prepareSpriteIdentityAdoption } = await import('../src/scene/character-identity.js');
    const floor = { chatId: 'fixture', messageId: 3, swipeId: 0, isAi: true, isLatest: true,
        text: '[igs-char:Alice|平静|你好。]\n[igs-char:Bob|平静|早上好。]' };
    const assets = { enabled: true, characters: {}, scenes: {}, characterDna: {} };
    const h = await expressionTemplateHarness(createTransactionalIdb(), {
        messageHost: { getChatId: () => 'fixture', readFloor: () => floor, readPreviousAiTexts: () => [] },
        getSettings: () => ({ autoIllustration: { assets: { spriteEnabled: true } }, sceneAssets: assets }),
        transformWritten(value) {
            for (const entry of value.captions) {
                const key = entry.characterMeta.characters[0].characterKey;
                for (const view of Object.values(entry.dnaCandidates.characters[0].views)) view.subject = `${key}, an adult with silver hair,`;
            }
        },
    });
    try {
        const generated = await h.service.processMessage(3, { manual: true });
        assert.equal(generated.ok, true, generated.error);
        assert.equal(generated.count, 2);
        assert.equal(h.writes.length, 1);
        assert.equal(h.paints.length, 2);
        assert.deepEqual(h.writes[0].promptTask.slots, [{ slotId: 1, tokens: ['r0'] }, { slotId: 2, tokens: ['r1'] }]);
        assert.deepEqual(assets.characterDna, {}, '生成成功不登记 DNA');
        const raw = createIndexedDbGeneratedAssetStore({ indexedDB: h.indexedDB });
        const records = await raw.getAssetsByChat('fixture');
        for (const record of records) {
            const image = await h.open().readStoredImage(record.imageId);
            assert.equal(image.promptTask.characters.length, 1);
            assert.equal(image.identityContext.length, 1);
            assert.equal(image.promptTask.characters[0].characterKey, record.name);
            assert.equal(image.dnaCandidates.characters[0].characterKey, record.name);
            assert.deepEqual(record.dnaCandidates, image.dnaCandidates);
            assert.deepEqual(record.sentPrompt, image.sentPrompt);
            assert.equal(image.prompt.caption.v4_prompt.caption.char_captions[0].char_caption,
                `${record.name}, an adult with silver hair, wears a white dress and smiles.`);
            const adopted = prepareSpriteIdentityAdoption(assets, record.name, image.id, image);
            assert.equal(adopted.ok, true, adopted.error);
            assert.equal(adopted.patch.characterDna[record.name].views.half_body.subject, `${record.name}, an adult with silver hair,`);
        }
    } finally { h.pipeline.imageGen.dispose(); }
});

test('gate:dna-compatibility:旧中文 DNA 同次转换，采用回读保留原字段', async () => {
    const { handleSettingsAction } = await import('../src/visual/igs-ui/settings-actions.js');
    const { Ok } = await import('../../../nai-dbgen/src/infra/result.js');
    const legacy = { identity: '成年女性，银发蓝眼，双黑角，长鳞尾，左侧银色发夹，珍珠耳饰，左手银戒', defaultAppearance: '蓝色外套',
        negative: '多余手指', triggerWords: '1.2::alice_tag::', identityInitialized: true, identitySource: 'old.png' };
    const views = {
        full_body: { subject: 'Alice, 1.2::alice_tag::, an adult woman with silver hair, blue eyes, two black horns, a long scaled tail, a silver hair clip on the left, pearl earrings and a silver ring on her left hand,' },
        half_body: { subject: 'Alice, 1.2::alice_tag::, an adult woman with silver hair, blue eyes, two black horns, a scaled tail visible beside her waist, a silver hair clip on the left, pearl earrings and a silver ring on her left hand,' },
        portrait: { subject: 'Alice, 1.2::alice_tag::, an adult woman with silver hair, blue eyes, two black horns, a silver hair clip on the left and pearl earrings,' },
    };
    const assets = { characters: { Alice: { 默认: 'old.png' } }, characterDna: { Alice: legacy } };
    const before = structuredClone(assets), saves = [];
    const h = await expressionTemplateHarness(createTransactionalIdb(), {
        async writePrompt(req, pipeline) {
            pipeline.llm.complete = async (input) => {
                pipeline.llmCalls.push(input);
                return Ok({ text: ['slotid: 1', 'prompt_mode: dna_template', 'outfit_mode: template',
                    'scene: One adult woman in a half-body composition against a transparent background.',
                    'scene_uc: blurry', 'char: 0.5,0.5 | <<dna:r0>> <<outfit:r0>> and smiles.',
                    'char_uc: <<dna_uc:r0>>', 'meta_kind: 0 | named', 'meta_key: 0 | Alice',
                    'meta_token: 0 | r0', 'meta_frame: 0 | half_body', 'meta_outfit_name: 0 |',
                    'meta_outfit_description: 0 |',
                    ...Object.entries(views).flatMap(([frame, view]) => [
                        `meta_dna_${frame}: 0 | ${view.subject}`, `meta_dna_uc_${frame}: 0 | extra fingers`,
                    ])].join('\n'), json: null });
            };
            return pipeline.workbench.writePrompt({ mode: 'floor', skipRecall: true,
                naturalLanguage: req.description, characterContext: req.characterContext, promptTask: req.promptTask,
                writingRequirements: req.writingRequirements, userPrompts: req.userPrompts });
        },
    });
    h.afterPaint(() => assert.deepEqual(assets, before, '发送成功仍未登记景别 DNA'));
    try {
        const result = await handleSettingsAction('char-generate-sprite:Alice', {
            state: { activeSettings: { draft: { bridge: { sceneAssets: assets } }, asyncState: {} } },
            options: { global: { alert() {} }, generatedAssets: h.service },
            dialogs: { prompt: async () => '', confirm: async () => true },
            persistSettingsDraft: () => { saves.push(JSON.parse(JSON.stringify(assets))); return { ok: true }; },
            rerenderSettings: () => ({ ok: true }),
        });
        assert.equal(result.ok, true, result.error);
        assert.equal(h.writes.length, 1); assert.equal(h.pipeline.llmCalls.length, 1); assert.equal(h.paints.length, 1);
        assert.deepEqual(h.writes[0].characterContext[0].dna, legacy);
        const message = h.pipeline.llmCalls[0].messages.at(-1).content;
        assert.ok(message.includes(legacy.identity)); assert.ok(message.includes(legacy.triggerWords));
        assert.match(message, /旧身份仅转换格式/);
        assert.match(message, /高优先级身份锚点/);
        assert.match(message, /不以当次半身立绘的裁切删掉尾巴或翅膀/);
        const image = await h.open().readStoredImage(assets.characters.Alice.默认.slice('igs-gen:'.length));
        assert.equal(image.dnaSnapshot.characters[0].source, 'candidate');
        assert.equal(image.prompt.caption.v4_prompt.caption.char_captions[0].char_caption,
            views.half_body.subject + ' ' + legacy.defaultAppearance + ' and smiles.');
        for (const feature of ['two black horns', 'scaled tail', 'silver hair clip', 'pearl earrings']) {
            assert.ok(image.sentPrompt.caption.v4_prompt.caption.char_captions[0].char_caption.includes(feature), feature);
            assert.ok(assets.characterDna.Alice.views.full_body.subject.includes(feature), feature);
        }
        assert.deepEqual(image.sentPrompt.caption.v4_prompt.caption, h.pipeline.naiCalls[0].payload.parameters.v4_prompt.caption);
        assert.deepEqual(image.dnaCandidates.characters[0].views, assets.characterDna.Alice.views);
        for (const field of Object.keys(legacy)) assert.equal(assets.characterDna.Alice[field], legacy[field], field);
        assert.equal(assets.characterDna.Alice.version, 2);
        assert.deepEqual(saves.at(-1).characterDna.Alice, assets.characterDna.Alice);
    } finally { h.pipeline.imageGen.dispose(); }
});

test('gate:dna-compatibility:无模板历史立绘复用旧协议且不伪造来源', async () => {
    const { handleSettingsAction } = await import('../src/visual/igs-ui/settings-actions.js');
    const h = await expressionTemplateHarness();
    const caption = cap('Legacy illustration, unknown artist source.');
    const store = createIndexedDbGeneratedAssetStore({ indexedDB: h.indexedDB });
    await store.putImage({ id: 'legacy', type: 'sprite', revision: 1,
        dataUrl: 'data:image/png;base64,QQ==', prompt: { positive: caption.v4_prompt.caption.base_caption,
            negative: 'lowres', caption } });
    const assets = { characters: { Alice: { 默认: 'igs-gen:legacy' } }, characterDna: {},
        characterOutfits: {}, wardrobe: {} };
    const before = structuredClone(assets);
    try {
        const result = await handleSettingsAction('char-generate-sprite:Alice', {
            state: { activeSettings: { draft: { bridge: { sceneAssets: assets } }, asyncState: {} } },
            options: { global: { alert() {} }, generatedAssets: h.service },
            persistSettingsDraft: () => ({ ok: true }), rerenderSettings: () => ({ ok: true }),
        });
        assert.equal(result.ok, true, result.error);
        assert.equal(h.writes.length, 0, '历史完整词不猜测转换成身份模板');
        assert.equal(h.paints.length, 1);
        for (const field of ['captionMode', 'capturePrompt', 'expectedConfigToken'])
            assert.equal(Object.hasOwn(h.paints[0], field), false, field);
        const saved = await h.open().readStoredImage(assets.characters.Alice.默认.slice('igs-gen:'.length));
        for (const field of ['promptRecipe', 'dnaSnapshot', 'sentPrompt', 'dnaCandidates'])
            assert.equal(saved[field], undefined, '旧协议不伪造新来源：' + field);
        for (const field of ['characterDna', 'characterOutfits', 'wardrobe'])
            assert.deepEqual(assets[field], before[field], field);
        assert.deepEqual((await store.getImage('legacy')).prompt.caption, caption, '历史记录保持不变');
        assert.ok(h.paints[0].caption.v4_prompt.caption.base_caption.includes('unknown artist source'));
    } finally { h.pipeline.imageGen.dispose(); }
});


test('gate:outfit-adoption:新衣装经权威回读提交，保存失败恢复且复用不重写', async () => {
    const { handleSettingsAction } = await import('../src/visual/igs-ui/settings-actions.js');
    for (const mode of ['success', 'save-failed', 'missing', 'wire-changed', 'scope-changed']) {
        const assets = { characters: { Alice: { 默认: 'igs-gen:base' } },
            characterDna: { Alice: { version: 2, views: characterViewsFixture() } },
            characterOutfits: { Alice: { 礼服: { words: ['dress'], moods: {} } } }, wardrobe: {} };
        const h = await expressionTemplateHarness(createTransactionalIdb(), {
            getSettings: () => ({ autoIllustration: {}, sceneAssets: assets }) });
        const before = structuredClone(assets), saves = [];
        const settings = { draft: { bridge: { sceneAssets: assets } }, asyncState: {} };
        let reads = 0;
        const ctx = { state: { activeSettings: settings },
            options: { global: { alert() {} }, generatedAssets: { ...h.service,
                getImagePrompt: async id => id === 'base' ? { caption: cap('base') } : h.service.getImagePrompt(id),
                async readStoredImage(id) {
                    reads++;
                    const record = await h.open().readStoredImage(id);
                    if (mode === 'missing') return null;
                    if (mode === 'wire-changed') record.sentPrompt.caption.v4_prompt.caption.base_caption += ' changed';
                    if (mode === 'scope-changed') settings.asyncState.assetScopeKey = 'card:other';
                    return record;
                } } },
            dialogs: { choose: async () => '1', confirm: async () => true, edit: async () => '', alert() {} },
            persistSettingsDraft() {
                saves.push(structuredClone(assets));
                return mode === 'save-failed' && saves.length === 1 ? { ok: false, reason: 'save-failed' } : { ok: true };
            }, rerenderSettings: () => ({ ok: true }) };
        try {
            const result = await handleSettingsAction('outfit-expression-set:Alice:' + encodeURIComponent('礼服'), ctx);
            assert.equal(reads, 1, JSON.stringify({ mode, result,
                writes: h.writes.length, paints: h.paints.length, saves: saves.length,
                errors: Object.values(assets.generated?.expressionNotes || {}).flatMap(notes => Object.values(notes).map(note => note.error)) }));
            if (mode !== 'success') {
                assert.equal(result.ok, false, mode);
                assert.deepEqual(assets, before, mode);
                assert.equal(saves.length, mode === 'save-failed' ? 2 : 0);
                continue;
            }
            assert.equal(result.ok, true, result.error);
            assert.equal(assets.wardrobe['Alice·礼服'].prompt, 'wears a white dress');
            assert.deepEqual(assets.characterDna, before.characterDna);
            const imageId = assets.characterOutfits.Alice.礼服.moods.平和.slice('igs-gen:'.length);
            const record = await h.open().readStoredImage(imageId);
            assert.equal(record.outfitSnapshot.characters[0].source, 'candidate');
            const reused = await h.service.generateExpressionSet({ name: 'Alice', dna: assets.characterDna.Alice,
                outfit: { name: '礼服' }, moods: ['喜悦'] });
            assert.equal(reused.items[0].ok, true, reused.items[0].error);
            assert.equal(reused.items[0].outfitSnapshot.characters[0].source, 'saved');
            assert.equal(reused.items[0].outfitSnapshot.characters[0].description, 'wears a white dress');
            assert.equal(h.writes.length, 2);
        } finally { h.pipeline.imageGen.dispose(); }
    }
});


for (const mode of ['save', 'sprite', 'save-failed', 'wire-changed', 'stale', 'missing-dna']) {
    test(`gate:story-outfit:${mode}:剧情候选明确采用与同图恢复`, async () => {
        const { createStoryOutfitService } = await import('../src/generated-images/illustration/story-outfit-service.js');
        const { loadStoryOutfitCandidates } = await import('../src/scene/outfit-review-store.js');
        const { effectiveSceneAssets } = await import('../src/scene/asset-scope.js');
        const { createMemoryStorage } = await import('../src/index.js');
        let root = { cards: { 'card:Source': { characters: { Alice: { 默认: 'original.png' } },
            characterDna: { Alice: { version: 2, views: mode === 'missing-dna' ? {} : characterViewsFixture() } },
            characterOutfits: {}, wardrobe: {} } } };
        const before = structuredClone(root), storage = createMemoryStorage();
        let hash = 'source-1', saves = 0;
        const h = await expressionTemplateHarness(createTransactionalIdb(), {
            getSettings: () => ({ autoIllustration: {}, sceneAssets: effectiveSceneAssets(root, 'card:Current') }),
            async writePrompt(req) {
                if (req.promptTask) return null;
                const caption = cap('wears a white dress');
                return { ok: true, value: { caption, captions: [{ slotId: 1, caption }] } };
            },
        });
        const deps = { storage, assets: { ...h.service, async readStoredImage(id) {
            const record = await h.open().readStoredImage(id);
            if (mode === 'wire-changed') record.sentPrompt.caption.v4_prompt.caption.base_caption += ' changed';
            if (mode === 'stale') hash = 'source-2';
            return record;
        } }, getContext: () => ({ root, scopeKey: 'card:Current', floorKey: 'chat|39|0', messageId: 39, sourceHash: hash }),
        commit(next, expected, guard) {
            assert.equal(guard(), true); assert.deepEqual(root, expected); saves++;
            if (mode === 'save-failed' && saves === 1) return { ok: false, reason: 'fixture-save' };
            root = structuredClone(next); return { ok: true };
        } };
        let service = createStoryOutfitService(deps);
        try {
            const directives = [{ character: 'Alice', unknownOutfit: '礼服' }];
            assert.equal(service.observe(directives).ok, true);
            const id = service.list()[0].id;
            await service.retry(id);
            service.observe(directives);
            assert.equal(h.writes.length, 1, '翻页不重复提取衣装');
            assert.equal(h.writes[0].messageId, 39);
            assert.deepEqual(root, before, '确认前不改衣柜');
            service.defer(id); assert.equal(service.list().length, 0);
            assert.equal(service.list({ includeDeferred: true }).length, 1);
            service.dispose(); service = createStoryOutfitService(deps);
            assert.equal(service.list()[0].id, id, '重启按冻结身份恢复');
            const result = await service.adopt(id, mode === 'save' ? 'save' : 'sprite');
            if (['wire-changed', 'stale', 'missing-dna'].includes(mode)) {
                assert.equal(result.ok, false, mode); assert.deepEqual(root, before); assert.equal(saves, 0);
                if (mode === 'missing-dna') assert.equal(h.paints.length, 0);
                return;
            }
            if (mode === 'save-failed') {
                assert.equal(result.reason, 'fixture-save'); assert.deepEqual(root, before);
                const imageId = loadStoryOutfitCandidates(storage).items[0].imageId;
                assert.ok(await h.open().readStoredImage(imageId));
                service.dispose(); service = createStoryOutfitService(deps);
                assert.equal((await service.adopt(id, 'sprite')).ok, true);
            } else assert.equal(result.ok, true, result.error);
            const library = root.cards['card:Source'];
            assert.equal(library.wardrobe['Alice·礼服'].prompt, 'wears a white dress');
            assert.deepEqual(library.characterDna, before.cards['card:Source'].characterDna);
            assert.deepEqual(library.characters, before.cards['card:Source'].characters);
            assert.equal(root.cards['card:Current'], undefined, '借用角色仍写原归属');
            assert.equal(h.paints.length, mode === 'save' ? 0 : 1, '保存失败重试不重新生图');
            if (mode !== 'save') assert.match(library.characterOutfits.Alice.礼服.moods.平和, /^igs-gen:/);
            assert.equal(loadStoryOutfitCandidates(storage).items.length, 0);
        } finally { service.dispose(); h.pipeline.imageGen.dispose(); }
    });
}
