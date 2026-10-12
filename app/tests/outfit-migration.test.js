import test from 'node:test';
import assert from 'node:assert/strict';
import { migrateOriginalOutfits, migrationRowOf, splitMigrationWords } from '../src/scene/outfit-migration.js';
import { handleOutfitAction } from '../src/visual/igs-ui/settings-outfit-actions.js';

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

test('gate:outfits:migration-moves-default-into-calm-and-clears-original', () => {
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
    // 默认那张进「平和」（这套衣服缺图时本来就兜底到它），其余槽同名直搬。
    assert.deepEqual(assets.characterOutfits.小林海斗.校服.moods, { 平和: 'igs-gen:base', 喜悦: 'igs-gen:joy', 害羞: 'igs-gen:shy' });
    // 等于自己服装名的别名是多余的（服装名本身就能解析），不重复收。
    assert.deepEqual(assets.characterOutfits.小林海斗.校服.words, ['制服']);
    assert.equal(assets.characterOutfits.小林海斗.校服.note, '上学时穿');
    // 服装显式引用同名衣柜条目，之后改名不会各走各的。
    assert.equal(assets.characterOutfits.小林海斗.校服.wardrobe, '校服');
    assert.deepEqual(assets.wardrobe.校服, { prompt: '' });
    // 原装清空，角色本身留着。
    assert.deepEqual(assets.characters.小林海斗, {});
    // 「调整立绘」的位置与头部标定整体搬进这套服装；默认那张的槽名同时改成平和。
    assert.deepEqual(rs.spriteLayouts['pc::小林海斗|校服'], { posX: 1 });
    assert.deepEqual(rs.spriteLayouts['pc::小林海斗|校服::平和'], { posX: 9 });
    assert.deepEqual(rs.spriteLayouts['pc::小林海斗|校服::喜悦'], { posX: 2 });
    assert.deepEqual(rs.spriteHeads['小林海斗|校服::平和'], { x: 9 });
    assert.deepEqual(rs.spriteHeads['小林海斗|校服::喜悦'], { x: 1 });
    // 只动这个角色：同前缀的别人和别的模式都不受影响。
    assert.deepEqual(rs.spriteLayouts['pc::小林'], { posX: 8 });
    assert.deepEqual(rs.spriteHeads.小林, { x: 8 });
    // 原装身份（恰好是「模式::小林海斗」那几个）已清空，不留孤儿。
    assert.ok(!Object.keys(rs.spriteLayouts).some((key) => /::小林海斗(::|$)/.test(key)));
    assert.ok(!Object.keys(rs.spriteHeads).some((key) => /^小林海斗(::|$)/.test(key)));
});

test('gate:outfits:migration-keeps-existing-calm-image-over-default', () => {
    const assets = { characters: { 雪乃: { 默认: 'igs-gen:base', 平和: 'igs-gen:own-calml' } } };
    const result = migrateOriginalOutfits({ sceneAssets: assets, readerSettings: {}, rows: [{ character: '雪乃', name: '常服' }] });
    assert.equal(result.done[0].replacedCalm, true);
    assert.deepEqual(assets.characterOutfits.雪乃.常服.moods, { 平和: 'igs-gen:own-calml' });
    assert.deepEqual(assets.characters.雪乃, {});
});

test('gate:outfits:migration-only-default-still-creates-outfit-for-aliases-and-note', () => {
    const assets = { characters: { 雪乃: { 默认: 'igs-gen:base' } } };
    const result = migrateOriginalOutfits({ sceneAssets: assets, readerSettings: {}, rows: [{ character: '雪乃', name: '玩偶装', words: ['睡衣', '玩偶装'], note: '睡觉时' }] });
    // 只有默认也必须建服装，否则别名和说明没有落点。
    assert.deepEqual(assets.characterOutfits.雪乃.玩偶装.moods, { 平和: 'igs-gen:base' });
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
    assert.equal(migrationRowOf('c', { 喜悦: 'y' }).hasSprite, false);
    assert.deepEqual(splitMigrationWords('睡衣、家居服, 玩偶装 睡衣'), ['睡衣', '家居服', '玩偶装']);
});

test('gate:outfits:migration-handler-seeds-list-then-applies-in-one-pass', async () => {
    const t = createCtx({ characters: { 小林海斗: { 默认: 'igs-gen:base' }, 雪乃: { 默认: 'igs-gen:b2', 喜悦: 'igs-gen:y' } } });
    await handleOutfitAction('scene-migrate-outfit', t.ctx);
    const rows = t.ctx.state.activeSettings.asyncState.migrateRows;
    assert.deepEqual(rows.map((row) => row.character), ['小林海斗', '雪乃']);
    // 默认名逐角色预填，用户在清单里改；这一步不落盘。
    assert.deepEqual(rows.map((row) => row.name), ['小林海斗', '雪乃原装']);
    assert.equal(t.persisted(), 0);
    rows[1].name = '玩偶装';
    await handleOutfitAction('scene-migrate-outfit-skip:' + encodeURIComponent('小林海斗'), t.ctx);
    assert.deepEqual(t.ctx.state.activeSettings.asyncState.migrateRows.map((row) => row.character), ['雪乃']);
    const done = await handleOutfitAction('scene-migrate-outfit-apply', t.ctx);
    assert.equal(done.ok, true);
    assert.deepEqual(t.sa().characters.雪乃, {});
    assert.equal(t.sa().characterOutfits.雪乃.玩偶装.wardrobe, '玩偶装');
    // 清单用完清掉，下次点功能键重新生成。
    assert.equal(t.ctx.state.activeSettings.asyncState.migrateRows, undefined);
    assert.match(t.alerts.join('\n'), /雪乃 → 服装「玩偶装」/);
});
