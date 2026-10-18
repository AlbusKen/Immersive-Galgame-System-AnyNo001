import test from 'node:test';
import assert from 'node:assert/strict';
import { migrateOriginalOutfits, promoteOutfitToOriginal, migrationRowOf, splitMigrationWords } from '../src/scene/outfit-migration.js';
import { handleOutfitAction } from '../src/visual/igs-ui/settings-outfit-actions.js';
import { renderCharacterAssetList } from '../src/visual/igs-ui/settings-fields.js';
import { renderMigrateEntry, renderCharacterSlotTabs } from '../src/visual/igs-ui/settings-outfit-fields.js';
import { migrateSpriteSystem } from '../src/scene/sprite-system-migration.js';
import { resolveSpriteAsset } from '../src/scene/asset-match.js';
import { effectiveSceneAssets } from '../src/scene/asset-scope.js';
import { normalizeSceneAssets } from '../src/visual/igs-ui/settings-host-normalize.js';
import { collectImageReferences } from '../src/media/image-references.js';
import { bootstrapIGS } from '../src/index.js';
import { handleSettingsAction } from '../src/visual/igs-ui/settings-actions.js';
import { singleCharacterContext } from '../src/generated-images/illustration/character-prompt-task.js';
import { createExpressionNotesFile } from '../src/storage/expression-notes-file.js';
import { builtinImageHarness } from './helpers/builtin-image-harness.js';
import { createAssetGenerationService } from './helpers/media-fixtures.js';
import { createMemoryGeneratedAssetStore } from '../src/media/generated-asset-store.js';
import { prepareSpriteMigration, SPRITE_MIGRATION_JOURNAL } from '../src/storage/sprite-migration-journal.js';
import { readLegacyIgsSettings } from '../src/storage/legacy-igs.js';
import { resolveSpriteOutfit } from '../src/scene/character-outfits.js';

const clone = value => structuredClone(value);
function memoryStorage(seed, fail = () => false) {
    const rows = new Map(Object.entries(seed)), writes = [];
    return { rows, writes, get length() { return rows.size; }, key: i => [...rows.keys()][i] ?? null,
        getItem: key => rows.get(key) ?? null, removeItem: key => rows.delete(key),
        setItem(key, value) { if (fail(key)) throw new Error('fixture quota'); rows.set(key, String(value)); writes.push(key); } };
}
const boot = storage => bootstrapIGS({ global: {}, storage, autoAttachMagicWand: false, tavernSettingsSync: false });

test('sprite-migration: 旧 DNA 衣装线索保持原显示，明确选新默认或升级后不再覆盖', () => {
    const assets = migrateSpriteSystem({ characters: { A: { 默认: 'igs-gen:old' } },
        characterDna: { A: { identity: 'old', defaultAppearance: 'wears 校服' } },
        characterOutfits: { A: { 校服: { words: [], moods: { 平和: 'igs-gen:school' } } } } }).sceneAssets;
    const read = () => resolveSpriteOutfit({ character: 'A', directives: [], sceneAssets: assets });
    assert.equal(read().outfit, '校服');
    assets.characterDefaultOutfits.A = { version: 1, outfitName: 'A·初始衣装' };
    assert.equal(read().outfit, '');
    assets.characterDefaultOutfits.A.migrated = true;
    assets.characterDna.A.version = 2;
    assert.equal(read().outfit, '');
});

test('sprite-migration: 只有衣柜图的角色也走新解析，不猜测用户的默认选择', () => {
    const assets = { characters: { A: {} }, characterOutfits: { A: {
        校服: { words: [], moods: {}, base: 'igs-gen:uniform' },
        睡衣: { words: [], moods: { 平和: 'igs-gen:night' } },
    } } };
    const hit = resolveSpriteAsset('A', '没命中', { sceneAssets: assets }, '校服');
    assert.equal(hit.url, 'igs-gen:uniform');
    assert.equal(hit.source, 'user-outfit');
    assert.equal(hit.selectionSource, 'requested');
    assert.equal(assets.characterDefaultOutfits, undefined);
});

test('sprite-migration: 中断留下半新配置时先回滚，恢复失败保留日志，之后可完整重迁', async () => {
    const bridge = JSON.stringify({ sceneAssets: { characters: { A: { 默认: 'igs-gen:old' } } } });
    const reader = JSON.stringify({ spriteLayouts: { 'pc::A::默认': { posX: 9 } } });
    let blocked = false;
    const storage = memoryStorage({ igs_bridge_config: bridge, 'igs-reader-settings-v9-default': reader },
        key => blocked && key === 'igs_bridge_config');
    prepareSpriteMigration(storage, [{ key: 'igs_bridge_config', previous: bridge },
        { key: 'igs-reader-settings-v9-default', previous: reader }]);
    storage.setItem('igs_bridge_config', JSON.stringify({ sceneAssets: migrateSpriteSystem(JSON.parse(bridge).sceneAssets).sceneAssets }));
    blocked = true;
    assert.equal(readLegacyIgsSettings(storage).ok, false);
    assert.ok(storage.getItem(SPRITE_MIGRATION_JOURNAL));
    blocked = false;
    const recovered = readLegacyIgsSettings(storage);
    assert.equal(recovered.bridge.sceneAssets.characters.A.默认, 'igs-gen:old');
    assert.equal(storage.getItem('igs-reader-settings-v9-default'), reader);
    assert.equal(storage.getItem(SPRITE_MIGRATION_JOURNAL), null);
    const api = boot(storage);
    try {
        const next = api.getUnifiedSettings();
        assert.equal(next.bridge.sceneAssets.characterOutfits.A['A·初始衣装'].base, 'igs-gen:old');
        assert.deepEqual(next.readerSettings.spriteLayouts['pc::A|A·初始衣装::默认'], { posX: 9 });
    } finally { await api.shutdown(); }
});

test('sprite-migration: 已有手改旧图也能显式补齐景别，并采用回同一默认衣装', async t => {
    const assets = migrateSpriteSystem({ characters: { A: { 默认: 'igs-gen:old' } },
        characterDna: { A: { identity: 'silver hair', defaultAppearance: 'blue coat' } } }).sceneAssets;
    assets.characterDna.A.version = 2;
    const fixture = createCtx(assets);
    const h = builtinImageHarness({ outfitName: 'A·初始衣装', bridge: { sceneAssets: fixture.sa(),
        imageApi: { mode: 'nai' }, autoIllustration: { nai: { apiKey: 'fixture-only', model: 'nai-diffusion-5-full' } } } });
    const store = createMemoryGeneratedAssetStore();
    const caption = { v4_prompt: { caption: { base_caption: 'old edited final', char_captions: [] } },
        v4_negative_prompt: { caption: { base_caption: '', char_captions: [] } } };
    await store.putImage({ id: 'old', type: 'sprite', dataUrl: 'data:image/png;base64,QQ==',
        prompt: { caption }, promptEdited: true });
    await store.putImage({ id: 'calm', type: 'sprite', dataUrl: 'data:image/png;base64,Qg==', prompt: { caption } });
    const service = createAssetGenerationService({ nai: h.backend, llm: h.llm, store,
        messageHost: { getChatId: () => 'fixture', readFloor: () => null, on: () => () => {} },
        getSettings: () => h.bridge, matte: async url => url });
    t.after(() => { service.stop(); h.dispose(); });
    fixture.ctx.options.generatedAssets = service;
    fixture.ctx.options.global.confirm = () => true;
    fixture.ctx.options.global.prompt = () => '';
    const result = await handleSettingsAction('char-generate-sprite:A', fixture.ctx);
    assert.notEqual(result.ok, false, JSON.stringify(result));
    assert.equal(h.writes.length, 1);
    const next = fixture.sa();
    for (const view of ['full_body', 'half_body', 'portrait'])
        assert.ok(next.characterDna.A.views?.[view]?.subject, view);
    assert.equal(next.characterDefaultOutfits.A.outfitName, 'A·初始衣装');
    assert.notEqual(next.characterOutfits.A['A·初始衣装'].base, 'igs-gen:old');
    assert.ok(await store.getImage('old'));
    assert.deepEqual(fixture.sa().characters.A, {});
});

test('sprite-migration: 首次文件备份成功后才移除设置里的续画备份', async () => {
    const storage = memoryStorage({ igs_bridge_config: JSON.stringify({ sceneAssets: {
        characters: { A: { 默认: 'igs-gen:old' } }, generated: { expressionNotes: {
            A: { 喜悦: { positive: 'preserved' } } } } } }) });
    const uploaded = new Map();
    const global = { localStorage: storage,
        SillyTavern: { getContext: () => ({ getRequestHeaders: () => ({}) }) },
        async fetch(url, init) {
            if (url === '/api/files/upload') {
                const payload = JSON.parse(init.body);
                uploaded.set(payload.name, JSON.parse(Buffer.from(payload.data, 'base64').toString()));
                return { ok: true, json: async () => ({ path: `/user/files/${payload.name}` }) };
            }
            assert.match(String(url), /^\/user\/files\//, '迁移不得访问生图接口');
            return { ok: false, status: 404 };
        },
    };
    const api = bootstrapIGS({ global, autoAttachMagicWand: false });
    try {
        assert.equal(JSON.parse(storage.getItem('igs_bridge_config')).sceneAssets.spriteMigrationNotesPending, true);
        const deadline = Date.now() + 4000;
        while (Date.now() < deadline && !uploaded.has('igs-expression-notes.json'))
            await new Promise(resolve => setTimeout(resolve, 25));
        assert.equal(uploaded.get('igs-expression-notes.json')?.notes['A\u0001A·初始衣装'].喜悦.positive, 'preserved');
        await new Promise(resolve => setTimeout(resolve, 0));
        const saved = JSON.parse(storage.getItem('igs_bridge_config')).sceneAssets;
        assert.equal(saved.spriteMigrationNotesPending, false);
        assert.equal(saved.generated.expressionNotes, undefined);
        assert.equal(api.getUnifiedSettings().bridge.sceneAssets.generated.expressionNotes['A\u0001A·初始衣装'].喜悦.positive, 'preserved');
    } finally { await api.shutdown(); }
});

test('sprite-migration: 旧续画资料在文件备份确认前跨重启保留', async () => {
    const storage = memoryStorage({ igs_bridge_config: JSON.stringify({ sceneAssets: {
        characters: { A: { 默认: 'igs-gen:old' } }, generated: { expressionNotes: {
            A: { 喜悦: { caption: { text: 'preserved' }, error: '已停止' } } } } } }) });
    let api = boot(storage);
    try {
        const saved = JSON.parse(storage.getItem('igs_bridge_config')).sceneAssets;
        assert.equal(saved.spriteMigrationNotesPending, true);
        assert.equal(saved.generated.expressionNotes['A\u0001A·初始衣装'].喜悦.caption.text, 'preserved');
    } finally { await api.shutdown(); }
    api = boot(storage);
    try { assert.equal(api.getUnifiedSettings().bridge.sceneAssets.generated.expressionNotes['A\u0001A·初始衣装'].喜悦.caption.text, 'preserved'); }
    finally { await api.shutdown(); }
});

test('sprite-migration: 文件确认只报告实际上传成功或已读回的同一版本', async () => {
    const confirmations = [], calls = [];
    let success = false;
    const file = createExpressionNotesFile({
        SillyTavern: { getContext: () => ({ getRequestHeaders: () => ({}) }) },
        async fetch(url) {
            calls.push(url);
            return url.startsWith('/user/files/') ? { ok: true, json: async () => ({ notes: { A: { 喜悦: { positive: 'old' } } } }) }
                : { ok: success };
        },
    }, { debounceMs: 10, onUploaded: body => confirmations.push(JSON.parse(body)) });
    await file.load();
    const notes = { 'A\u0001A·初始衣装': { 喜悦: { positive: 'new' } } };
    file.save(notes); file.flush();
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.deepEqual(confirmations, []);
    success = true;
    file.save(notes); file.flush();
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.deepEqual(confirmations, [notes]);
    assert.equal(calls.filter(url => url === '/api/files/upload').length, 2);
});

test('sprite-migration: 导入旧资料经过同一保存入口迁移', async () => {
    const storage = memoryStorage({ igs_bridge_config: '{}' }), api = boot(storage);
    try {
        const ctl = api.openSettings({ tab: 'basic' }).controller;
        ctl.setValue('bridge.sceneAssets', { characters: { A: { 默认: 'igs-gen:imported' } } });
        assert.notEqual(ctl.close().ok, false);
        const next = api.getUnifiedSettings().bridge.sceneAssets;
        assert.equal(next.characterOutfits.A['A·初始衣装'].base, 'igs-gen:imported');
        assert.equal(next.characterDefaultOutfits.A.outfitName, 'A·初始衣装');
        assert.deepEqual(next.characters.A, {});
    } finally { await api.shutdown(); }
});

test('sprite-migration: 未补齐景别时提供补齐入口，衣装缺说明也保留原目标名', () => {
    const assets = migrateSpriteSystem({ characters: { A: { 默认: 'igs-gen:old' } },
        characterDna: { A: { version: 2, identity: 'legacy' } } }).sceneAssets;
    const context = singleCharacterContext('A', assets.characterDna.A, undefined, assets);
    assert.equal(context[0].outfit.name, 'A·初始衣装');
    assert.equal(context[0].outfit.description, '');
    const html = renderCharacterSlotTabs({ charName: 'A', baseMoods: [], baseListHtml: '',
        outfits: assets.characterOutfits.A, activeOutfit: '', sceneAssets: assets,
        icons: {}, expressionNotes: {}, resolveUrl: url => url });
    assert.match(html, /data-action="char-generate-sprite:A"/);

});

test('sprite-migration: 基础图编辑写入新结构，最后一张默认图仍受保护', async () => {
    const t = createCtx(migrateSpriteSystem({ characters: { A: { 默认: 'igs-gen:old' } } }).sceneAssets);
    t.ctx.options.global.Image = class {
        naturalWidth = 1; naturalHeight = 1;
        set src(value) { if (value) queueMicrotask(() => this.onload?.()); }
    };
    await handleOutfitAction('scene-set-outfit-mood-url:A:' + encodeURIComponent('A·初始衣装') + ':' + encodeURIComponent('默认') + ':new.png', t.ctx);
    assert.equal(t.sa().characterOutfits.A['A·初始衣装'].base, 'new.png');
    const result = await handleOutfitAction('scene-remove-outfit-mood:A:' + encodeURIComponent('A·初始衣装') + ':' + encodeURIComponent('默认'), t.ctx);
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'default-outfit-protected');
    assert.equal(t.sa().characterOutfits.A['A·初始衣装'].base, 'new.png');
    assert.deepEqual(t.sa().characters.A, {});
});

test('sprite-migration: 迁入后的基础图可查看、编辑与重画，不写回旧槽', async () => {
    const t = createCtx(migrateSpriteSystem({ characters: { A: { 默认: 'igs-gen:old', 平和: 'igs-gen:calm' } },
        characterDna: { A: { identity: 'blue hair' } } }).sceneAssets);
    const entry = t.sa().characterOutfits.A['A·初始衣装'];
    const html = renderCharacterSlotTabs({ charName: 'A', baseMoods: [], baseListHtml: '',
        outfits: t.sa().characterOutfits.A, activeOutfit: '', sceneAssets: t.sa(), icons: {},
        expressionNotes: {}, resolveUrl: url => url });
    assert.match(html, /data-outfit-slot="默认"/);
    assert.match(html, /data-outfit-slot="平和"/);
    const requests = [];
    const caption = { v4_prompt: { caption: { base_caption: 'old final', char_captions: [] } },
        v4_negative_prompt: { caption: { base_caption: '', char_captions: [] } } };
    t.ctx.options.generatedAssets = {
        getImagePrompt: async () => ({ caption, edited: true }),
        generateExpressionSet: async () => assert.fail('单图重画不得请求整套表情'),
        generateExpressionImage: async input => {
            requests.push(input);
            return { ok: true, items: [{ ok: true, mood: input.mood, imageId: 'new' }] };
        },
    };
    t.ctx.options.global.confirm = () => true;
    const result = await handleSettingsAction('outfit-expression-retry:A:' + encodeURIComponent('A·初始衣装') + ':' + encodeURIComponent('默认'), t.ctx);
    assert.notEqual(result.ok, false, JSON.stringify(result));
    assert.equal(requests.length, 1);
    assert.equal(requests[0].mood, '默认');
    assert.deepEqual(requests[0].caption, caption);
    assert.equal(t.sa().characterOutfits.A['A·初始衣装'].base, 'igs-gen:new');
    assert.equal(t.sa().characterOutfits.A['A·初始衣装'].moods.平和, 'igs-gen:calm');
    assert.deepEqual(t.sa().characters.A, {});
    assert.equal(entry.moods.平和, 'igs-gen:calm');
});

test('sprite-migration: 自动迁移所有作用域，原图与默认/平和分离，重跑不制造新衣装', () => {
    const assets = { characters: { A: { 默认: 'igs-gen:base', 平和: 'igs-gen:calm', 喜悦: 'igs-gen:joy' } },
        characterDna: { A: { identity: 'old identity', defaultAppearance: 'old clothes' } },
        generated: { characters: { A: { 默认: 'igs-gen:other', 害羞: 'igs-gen:shy' } }, characterAliases: { A: ['Alias'] } },
        cards: { 'card:one': { characters: { A: { 默认: 'igs-gen:card-one' } } },
            'card:two': { characters: { B: { 喜悦: 'igs-gen:card-two' } } } } };
    const source = clone(assets), modes = { default: { spriteHeads: { 'A::默认': { x: 1 }, 'A::平和': { x: 2 } } } };
    const result = migrateSpriteSystem(assets, modes);
    assert.deepEqual(assets, source);
    assert.equal(result.changed, true);
    const next = normalizeSceneAssets(result.sceneAssets);
    assert.equal(next.characterOutfits.A['A·初始衣装'].base, 'igs-gen:base');
    assert.equal(next.characterOutfits.A['A·初始衣装'].moods.平和, 'igs-gen:calm');
    assert.equal(next.characterOutfits.A.旧生成立绘.base, 'igs-gen:other');
    assert.equal(next.characterOutfits.A['A·初始衣装'].moods.害羞, 'igs-gen:shy');
    assert.equal(next.characterDna.A.identity, 'old identity');
    assert.equal(next.characterDna.A.version, undefined);
    assert.equal(resolveSpriteAsset('A', '没命中', { sceneAssets: next }).url, 'igs-gen:base');
    assert.equal(resolveSpriteAsset('A', '平和', { sceneAssets: next }).url, 'igs-gen:calm');
    assert.equal(resolveSpriteAsset('A', '默认', { sceneAssets: effectiveSceneAssets(next, 'card:one') }).url, 'igs-gen:card-one');
    assert.equal(resolveSpriteAsset('B', '喜悦', { sceneAssets: effectiveSceneAssets(next, 'card:two') }).url, 'igs-gen:card-two');
    assert.deepEqual(collectImageReferences(assets).ids, collectImageReferences(next).ids);
    assert.deepEqual(result.readerSettingsByMode.default.spriteHeads['A|A·初始衣装::默认'], { x: 1 });
    assert.deepEqual(result.readerSettingsByMode.default.spriteHeads['A|A·初始衣装::平和'], { x: 2 });
    assert.equal(migrateSpriteSystem(next, result.readerSettingsByMode).changed, false);
});

test('sprite-migration: 同名衣装/衣柜不覆盖，明确选过的默认不改变', () => {
    const chosen = { words: [], moods: { 平和: 'igs-gen:selected' } };
    const assets = { characters: { A: { 默认: 'igs-gen:old' } },
        characterOutfits: { A: { 'A·初始衣装': chosen } }, wardrobe: { 'A·初始衣装': { prompt: 'keep' } },
        characterDefaultOutfits: { A: { version: 1, outfitName: 'A·初始衣装' } } };
    const next = migrateSpriteSystem(assets).sceneAssets;
    assert.deepEqual(next.characterOutfits.A['A·初始衣装'], chosen);
    assert.equal(next.characterOutfits.A['A·初始衣装 2'].base, 'igs-gen:old');
    assert.deepEqual(next.wardrobe['A·初始衣装'], { prompt: 'keep' });
    assert.deepEqual(next.characterDefaultOutfits, assets.characterDefaultOutfits);
});

test('sprite-migration: 多角色初始衣装及衣柜名称各自独立，空说明也不共用', () => {
    const next = migrateSpriteSystem({ characters: {
        A: { 默认: 'igs-gen:a' }, B: { 默认: 'igs-gen:b' },
    } }).sceneAssets;
    for (const character of ['A', 'B']) {
        const name = `${character}·初始衣装`;
        assert.equal(next.characterDefaultOutfits[character].outfitName, name);
        assert.equal(next.characterOutfits[character][name].wardrobe, name);
        assert.deepEqual(next.wardrobe[name], { prompt: '' });
    }
    next.wardrobe['A·初始衣装'].prompt = 'red dress';
    assert.equal(next.wardrobe['B·初始衣装'].prompt, '');
    assert.equal(migrateSpriteSystem(next).changed, false);
});

test('sprite-migration: 旧测试包的通用迁移名修正并同步引用，保留图片和旧标签别名', () => {
    const assets = { characters: { A: {}, B: {} },
        characterOutfits: Object.fromEntries(['A', 'B'].map(character => [character, {
            初始衣装: { legacyOriginal: 1, words: [], moods: { 喜悦: `igs-gen:${character}-joy` },
                base: `igs-gen:${character}`, wardrobe: '初始衣装' },
        }])),
        characterDefaultOutfits: Object.fromEntries(['A', 'B'].map(character => [character,
            { version: 1, outfitName: '初始衣装', migrated: true }])),
        wardrobe: { 初始衣装: { prompt: '', nsfwBoost: true } },
        generated: { expressionNotes: { 'A\u0001初始衣装': { 喜悦: { caption: 'kept' } } } },
    };
    const source = clone(assets);
    const migrated = migrateSpriteSystem(assets, { default: {
        spriteHeads: { 'A|初始衣装::默认': { x: 8 } },
        spriteLayouts: { 'pc::A|初始衣装::默认': { posX: 2 } },
    } });
    const next = migrated.sceneAssets;
    assert.deepEqual(assets, source);
    for (const character of ['A', 'B']) {
        const name = `${character}·初始衣装`;
        assert.equal(next.characterOutfits[character][name].base, `igs-gen:${character}`);
        assert.equal(next.characterOutfits[character][name].wardrobe, name);
        assert.equal(next.characterDefaultOutfits[character].outfitName, name);
        assert.equal(next.characterOutfits[character][name].words.includes('初始衣装'), true);
        assert.equal(next.wardrobe[name].nsfwBoost, true);
        assert.equal(next.characterOutfits[character].初始衣装, undefined);
    }
    assert.deepEqual(next.generated.expressionNotes['A\u0001A·初始衣装'], { 喜悦: { caption: 'kept' } });
    assert.deepEqual(migrated.readerSettingsByMode.default.spriteHeads['A|A·初始衣装::默认'], { x: 8 });
    assert.deepEqual(migrated.readerSettingsByMode.default.spriteLayouts['pc::A|A·初始衣装::默认'], { posX: 2 });
    assert.equal(migrateSpriteSystem(next, migrated.readerSettingsByMode).changed, false);
});

test('sprite-migration: 晚到的旧续画资料归原衣装，保留新记录', () => {
    const first = migrateSpriteSystem({ characters: { A: { 默认: 'igs-gen:a' } } }).sceneAssets;
    first.characterDefaultOutfits.A = { version: 1, outfitName: '新衣' };
    first.generated.expressionNotes = { A: { 喜悦: { caption: 'old' }, 默认: { caption: 'base' } },
        'A\u0001A·初始衣装': { 喜悦: { caption: 'new' } } };
    const next = migrateSpriteSystem(first).sceneAssets;
    assert.deepEqual(next.generated.expressionNotes['A\u0001A·初始衣装'], { 喜悦: { caption: 'new' }, 默认: { caption: 'base' } });
    assert.equal(next.generated.expressionNotes.A, undefined);
    assert.equal(next.characterDefaultOutfits.A.outfitName, '新衣');
});

test('sprite-migration: 冷启动保存后统一读新默认，重启幂等且不发生成请求', async () => {
    const storage = memoryStorage({ igs_bridge_config: JSON.stringify({ sceneAssets: {
        enabled: true, characters: { A: { 默认: 'igs-gen:base', 平和: 'igs-gen:calm' } } } }),
        'igs-reader-settings-v9-pc': JSON.stringify({ spriteLayouts: { 'pc::A::默认': { posX: 5 } } }) });
    let api = boot(storage);
    let expected;
    try {
        const snapshot = api.getUnifiedSettings();
        assert.deepEqual(snapshot.bridge.sceneAssets.characters.A, {});
        assert.equal(snapshot.bridge.sceneAssets.characterDefaultOutfits.A.outfitName, 'A·初始衣装');
        assert.deepEqual(snapshot.readerSettings.spriteLayouts['pc::A|A·初始衣装::默认'], { posX: 5 });
        const saved = JSON.parse(storage.getItem('igs_bridge_config'));
        assert.equal(saved.sceneAssets.characterOutfits.A['A·初始衣装'].base, 'igs-gen:base');
        expected = clone(saved);
    } finally { await api.shutdown(); }
    api = boot(storage);
    try { assert.deepEqual(JSON.parse(storage.getItem('igs_bridge_config')), expected); }
    finally { await api.shutdown(); }
});

for (const silent of [false, true]) test(`sprite-migration: ${silent ? '静默' : '抛错'}保存失败不切换，可在后续保存恢复`, async () => {
    const initial = JSON.stringify({ sceneAssets: { enabled: true, characters: { A: { 默认: 'igs-gen:old', 平和: 'igs-gen:calm' } } } });
    let failure = true;
    const storage = memoryStorage({ igs_bridge_config: initial }, key => !silent && failure && key === 'igs-reader-settings-v9-default');
    const write = storage.setItem;
    if (silent) storage.setItem = (key, value) => { if (failure && key === 'igs_bridge_config') return; write(key, value); };
    const api = boot(storage);
    try {
        assert.equal(storage.getItem('igs_bridge_config'), initial);
        assert.equal(api.getUnifiedSettings().bridge.sceneAssets.characters.A.默认, 'igs-gen:old');
        assert.equal(api.getUnifiedSettings().bridge.sceneAssets.characterDefaultOutfits, undefined);
        failure = false;
        const controller = api.openSettings({ tab: 'basic' }).controller;
        controller.setValue('bridge.showToasts', false);
        assert.notEqual(controller.close().ok, false);
        assert.equal(api.getUnifiedSettings().bridge.sceneAssets.characterOutfits.A['A·初始衣装'].base, 'igs-gen:old');
    } finally { await api.shutdown(); }
});

test('sprite-migration: 旧提升入口只设置新默认，保留两套图和全部标定', () => {
    const assets = { characters: { A: { 默认: 'old' } }, characterOutfits: { A: { 校服: { words: [], moods: { 平和: 'new' } } } } };
    const before = clone(assets);
    const result = promoteOutfitToOriginal({ sceneAssets: assets, character: 'A', outfit: '校服' });
    assert.equal(result.ok, true);
    assert.deepEqual(assets.characters, before.characters);
    assert.deepEqual(assets.characterOutfits, before.characterOutfits);
    assert.deepEqual(assets.characterDefaultOutfits.A, { version: 1, outfitName: '校服' });
});

test('sprite-migration: 角色卡手动迁移保存失败回滚，不触及全局同名角色', async () => {
    const t = createCtx({ characters: { A: { 默认: 'global' } }, cards: { 'card:C': { characters: { A: { 默认: 'card' } } } } });
    t.state.activeSettings.asyncState = { assetScopeKey: 'card:C', migrateRows: [{ character: 'A', name: '校服' }] };
    const before = clone(t.state.activeSettings.draft);
    t.ctx.persistSettingsDraft = () => ({ ok: false, reason: 'fixture' });
    const result = await handleOutfitAction('scene-migrate-outfit-apply', t.ctx);
    assert.equal(result.ok, false);
    assert.deepEqual(t.state.activeSettings.draft, before);
});

function createCtx(assets = {}) {
    const alerts = [];
    const state = {
        activeSettings: {
            tab: 'scene',
            asyncState: {},
            draft: {
                bridge: {
                    sceneAssets: {
                        characters: {},
                        characterAliases: {},
                        characterOutfits: {},
                        wardrobe: {},
                        moodGroups: [{ label: '平和', words: ['平和'] }],
                        generated: { characters: {}, expressionNotes: {} },
                        ...assets,
                    },
                },
                readerSettings: { spriteLayouts: {}, spriteHeads: {} },
            },
        },
    };
    let persisted = 0;
    const ctx = {
        state,
        settingsState: state.activeSettings,
        options: { global: { alert: (m) => alerts.push(m) } },
        persistSettingsDraft: () => { persisted++; return { ok: true }; },
        rerenderSettings: () => ({ ok: true, rerendered: true }),
    };
    return { ctx, state, alerts, persisted: () => persisted, sa: () => state.activeSettings.draft.bridge.sceneAssets, rs: () => state.activeSettings.draft.readerSettings };
}

test('gate:outfits:migration-keeps-base-separate-and-moves-all-calibrations', () => {
    const assets = { characters: { 小林海斗: { 默认: 'igs-gen:base', 喜悦: 'igs-gen:joy', 害羞: 'igs-gen:shy' } } };
    const rs = {
        spriteLayouts: { 'pc::小林海斗': { posX: 1 }, 'pc::小林海斗::默认': { posX: 9 }, 'pc::小林海斗::喜悦': { posX: 2 }, 'pc::小林': { posX: 8 } },
        spriteHeads: { '小林海斗::喜悦': { x: 1 }, '小林海斗::默认': { x: 9 }, 小林: { x: 8 } },
    };
    const result = migrateOriginalOutfits({
        sceneAssets: assets,
        readerSettings: rs,
        rows: [{ character: '小林海斗', name: '校服', words: ['制服', '校服'], note: '上学时穿' }],
    });
    assert.equal(result.ok, true);
    assert.deepEqual(result.skipped, []);
    // 基础图与表情分开保留，避免覆盖已有平和图。
    assert.deepEqual(assets.characterOutfits.小林海斗.校服.moods, { 喜悦: 'igs-gen:joy', 害羞: 'igs-gen:shy' });
    assert.equal(assets.characterOutfits.小林海斗.校服.base, 'igs-gen:base');
    // 等于自己服装名的别名是多余的（服装名本身就能解析），不重复收。
    assert.deepEqual(assets.characterOutfits.小林海斗.校服.words, ['制服']);
    assert.equal(assets.characterOutfits.小林海斗.校服.note, '上学时穿');
    // 服装显式引用同名衣柜条目，之后改名不会各走各的。
    assert.equal(assets.characterOutfits.小林海斗.校服.wardrobe, '校服');
    assert.deepEqual(assets.wardrobe.校服, { prompt: '' });
    // 原装清空，角色本身留着。
    assert.deepEqual(assets.characters.小林海斗, {});
    // 标定随真实衣装身份迁移，基础图与平和图仍用各自的槽名。
    assert.deepEqual(rs.spriteLayouts['pc::小林海斗|校服'], { posX: 1 });
    assert.deepEqual(rs.spriteLayouts['pc::小林海斗|校服::默认'], { posX: 9 });
    assert.deepEqual(rs.spriteLayouts['pc::小林海斗|校服::喜悦'], { posX: 2 });
    assert.deepEqual(rs.spriteHeads['小林海斗|校服::默认'], { x: 9 });
    assert.deepEqual(rs.spriteHeads['小林海斗|校服::喜悦'], { x: 1 });
    // 只动这个角色：同前缀的别人和别的模式都不受影响。
    assert.deepEqual(rs.spriteLayouts['pc::小林'], { posX: 8 });
    assert.deepEqual(rs.spriteHeads.小林, { x: 8 });
    // 原装身份（恰好是「模式::小林海斗」那几个）已清空，不留孤儿。
    assert.ok(!Object.keys(rs.spriteLayouts).some((key) => /::小林海斗(::|$)/.test(key)));
    assert.ok(!Object.keys(rs.spriteHeads).some((key) => /^小林海斗(::|$)/.test(key)));
});

test('gate:outfits:migration-preserves-both-calm-and-base', () => {
    const assets = { characters: { 雪乃: { 默认: 'igs-gen:base', 平和: 'igs-gen:own-calml' } } };
    const result = migrateOriginalOutfits({ sceneAssets: assets, readerSettings: {}, rows: [{ character: '雪乃', name: '常服' }] });
    assert.equal(result.done[0].replacedCalm, false);
    assert.equal(assets.characterOutfits.雪乃.常服.base, 'igs-gen:base');
    assert.deepEqual(assets.characterOutfits.雪乃.常服.moods, { 平和: 'igs-gen:own-calml' });
    assert.deepEqual(assets.characters.雪乃, {});
});

test('gate:outfits:migration-preserves-calm-only-old-original', () => {
    const assets = { characters: { 雪乃: { 平和: 'igs-gen:calm' } } };
    const rs = { spriteLayouts: { 'pc::雪乃::平和': { posX: 5 } } };
    const result = migrateOriginalOutfits({ sceneAssets: assets, readerSettings: rs, rows: [{ character: '雪乃', name: '旧衣' }] });
    assert.equal(result.done.length, 1);
    assert.deepEqual(assets.characterOutfits.雪乃.旧衣.moods, { 平和: 'igs-gen:calm' });
    assert.deepEqual(rs.spriteLayouts['pc::雪乃|旧衣::平和'], { posX: 5 });
});

test('gate:outfits:migration-only-default-still-creates-outfit-for-aliases-and-note', () => {
    const assets = { characters: { 雪乃: { 默认: 'igs-gen:base' } } };
    const result = migrateOriginalOutfits({ sceneAssets: assets, readerSettings: {}, rows: [{ character: '雪乃', name: '玩偶装', words: ['睡衣', '玩偶装'], note: '睡觉时' }] });
    // 只有默认也必须建服装，否则别名和说明没有落点。
    assert.deepEqual(assets.characterOutfits.雪乃.玩偶装.moods, {});
    assert.equal(assets.characterOutfits.雪乃.玩偶装.base, 'igs-gen:base');
    // 和服装名一样的别名多余（服装名本身就能解析），丢掉。
    assert.deepEqual(assets.characterOutfits.雪乃.玩偶装.words, ['睡衣']);
    assert.equal(assets.characterOutfits.雪乃.玩偶装.note, '睡觉时');
    assert.equal(result.done[0].replacedCalm, false);
});

test('gate:outfits:migration-rejects-reserved-and-taken-names-and-lone-word-collisions', () => {
    const assets = {
        characters: { 小林海斗: { 默认: 'igs-gen:base' }, 雪乃: { 默认: 'igs-gen:b2' } },
        characterOutfits: { 小林海斗: { 校服: { words: ['制服'], moods: {} } } },
        wardrobe: { 睡衣: { prompt: '已有的词' } },
    };
    const result = migrateOriginalOutfits({
        sceneAssets: assets,
        readerSettings: {},
        rows: [
            { character: '小林海斗', name: '默认' },
            { character: '小林海斗', name: '校服' },
            { character: '小林海斗', name: '  ' },
            { character: '雪乃', name: '睡衣', words: ['制服', '玩偶装'] },
        ],
    });
    assert.deepEqual(result.skipped.map((item) => item.character), ['小林海斗', '小林海斗', '小林海斗']);
    // 词池互斥只在本角色内算：「制服」是别人名下服装的词，本角色可以照用。
    assert.deepEqual(assets.characterOutfits.雪乃.睡衣.words, ['制服', '玩偶装']);
    // 同名衣柜条目已存在就复用，不是另建一条。
    assert.equal(assets.wardrobe.睡衣.prompt, '已有的词');
});

test('gate:outfits:migration-moves-expression-notes-without-dropping-newer-ones', () => {
    const assets = {
        characters: { 小林海斗: { 默认: 'igs-gen:base' } },
        generated: {
            characters: {},
            // 原装那边与目标服装那边都有注记时，新写的不能丢。
            expressionNotes: { 小林海斗: { 喜悦: { caption: 'base' } }, '小林海斗\u0001校服': { 害羞: { caption: 'outfit' } } },
        },
    };
    migrateOriginalOutfits({ sceneAssets: assets, readerSettings: {}, rows: [{ character: '小林海斗', name: '校服' }] });
    assert.deepEqual(assets.generated.expressionNotes['小林海斗\u0001校服'], { 害羞: { caption: 'outfit' }, 喜悦: { caption: 'base' } });
    assert.ok(!Object.prototype.hasOwnProperty.call(assets.generated.expressionNotes, '小林海斗'));
});

test('gate:outfits:migration-row-stats-distinguish-whole-from-default-only', () => {
    assert.equal(migrationRowOf('a', { 默认: 'x' }).stat, '仅默认');
    assert.equal(migrationRowOf('b', { 默认: 'x', 喜悦: 'y' }).stat, '整套 2 张');
    assert.equal(migrationRowOf('c', { 喜悦: 'y' }).hasSprite, true);
    assert.deepEqual(splitMigrationWords('睡衣、家居服, 玩偶装、睡衣'), ['睡衣', '家居服', '玩偶装']);
    assert.deepEqual(splitMigrationWords('旅行 风衣、家居服'), ['旅行 风衣', '家居服']);
});

test('gate:outfits:migration-character-menu-seeds-only-selected-character-and-applies', async () => {
    const t = createCtx({ characters: { 小林海斗: { 默认: 'igs-gen:base' }, 雪乃: { 默认: 'igs-gen:b2', 喜悦: 'igs-gen:y' } } });
    const html = renderCharacterAssetList(t.sa().characters);
    assert.match(html, /data-action="scene-migrate-outfit:%E9%9B%AA%E4%B9%83"/);
    assert.equal(renderMigrateEntry(undefined), '');
    const requested = [];
    t.ctx.options.generatedAssets = { getImagePrompt: async (id) => { requested.push(id); return { positive: '原装提示词' }; } };
    await handleOutfitAction('scene-migrate-outfit:' + encodeURIComponent('雪乃'), t.ctx);
    const rows = t.ctx.state.activeSettings.asyncState.migrateRows;
    assert.deepEqual(rows.map((row) => row.character), ['雪乃']);
    assert.deepEqual(rows.map((row) => row.name), ['雪乃原装']);
    assert.equal(t.persisted(), 0);
    rows[0].name = '玩偶装';
    rows[0].words = ['旅行 风衣'];
    const done = await handleOutfitAction('scene-migrate-outfit-apply', t.ctx);
    assert.equal(done.ok, true);
    assert.deepEqual(requested, ['b2']);
    assert.deepEqual(t.sa().characters.雪乃, {});
    assert.deepEqual(t.sa().characters.小林海斗, { 默认: 'igs-gen:base' });
    assert.equal(t.sa().characterOutfits.雪乃.玩偶装.wardrobe, '玩偶装');
    assert.deepEqual(t.sa().characterOutfits.雪乃.玩偶装.words, ['旅行 风衣']);
    assert.equal(t.sa().wardrobe.玩偶装.prompt, '原装提示词');
    assert.equal(t.persisted(), 1);
    assert.equal(t.ctx.state.activeSettings.asyncState.migrateRows, undefined);
});
