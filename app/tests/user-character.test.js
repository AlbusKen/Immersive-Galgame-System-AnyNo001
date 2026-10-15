import test from 'node:test';
import assert from 'node:assert/strict';
import { handleSettingsAction } from '../src/visual/igs-ui/settings-actions.js';
import { renderCharacterAssetList } from '../src/visual/igs-ui/settings-fields.js';
import { extractSceneDirectives } from '../src/scene/scene-directives.js';
import { prepareReaderFloor } from '../src/visual/igs-ui/reader-floor-plan.js';
import { effectiveSceneAssets } from '../src/scene/asset-scope.js';

function memoryStorage() {
    const m = new Map();
    return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
}

function makeCtx({ userCharacter = '', rename = '' } = {}) {
    const sceneAssets = { enabled: true, userCharacter, characters: { 白墨: { 平和: 'a' }, 小雪: { 平和: 'b' } }, characterAliases: {} };
    const draft = { bridge: { sceneAssets }, readerSettings: {} };
    const ctx = {
        state: { activeSettings: { draft, readerMode: 'pc', asyncState: { expandedSceneSlots: new Set() } } },
        options: { global: { localStorage: memoryStorage(), prompt: () => rename, confirm: () => true, alert() {} } },
        closeSettings: () => ({ ok: true }),
        persistSettingsDraft: () => ({ ok: true }),
        rerenderSettings: () => ({ ok: true }),
        buildRegexPreview: () => '',
    };
    return { ctx, sceneAssets };
}

test('USER 立绘：同卡只一个，设为他人即覆盖，再点同一人清空', async () => {
    const { ctx, sceneAssets } = makeCtx();
    await handleSettingsAction('scene-set-user-char:白墨', ctx);
    assert.equal(sceneAssets.userCharacter, '白墨');
    await handleSettingsAction('scene-set-user-char:' + encodeURIComponent('小雪'), ctx);
    assert.equal(sceneAssets.userCharacter, '小雪');
    await handleSettingsAction('scene-set-user-char:' + encodeURIComponent('小雪'), ctx);
    assert.equal(sceneAssets.userCharacter, '');
});

test('USER 立绘：重命名跟着改，删除时清空', async () => {
    const renamed = makeCtx({ userCharacter: '白墨', rename: '白墨二号' });
    await handleSettingsAction('scene-rename-char:' + encodeURIComponent('白墨'), renamed.ctx);
    assert.equal(renamed.sceneAssets.userCharacter, '白墨二号');
    const other = makeCtx({ userCharacter: '白墨', rename: '雪儿' });
    await handleSettingsAction('scene-rename-char:' + encodeURIComponent('小雪'), other.ctx);
    assert.equal(other.sceneAssets.userCharacter, '白墨');
    const removed = makeCtx({ userCharacter: '白墨' });
    await handleSettingsAction('scene-remove-char:' + encodeURIComponent('白墨'), removed.ctx);
    assert.equal(removed.sceneAssets.userCharacter, '');
});

test('USER 立绘：菜单文字与徽标随指定状态切换', () => {
    const chars = { 白墨: { 平和: 'a' }, 小雪: { 平和: 'b' } };
    const html = (userCharacter) => renderCharacterAssetList(chars, { sceneAssets: { userCharacter, characters: chars } });
    const none = html('');
    assert.equal(none.split('设为User立绘').length - 1, 2);
    assert.ok(!none.includes('取消User立绘') && !none.includes('igs-char-user-tag'));
    const set = html('白墨');
    assert.equal(set.split('取消User立绘').length - 1, 1);
    assert.equal(set.split('设为User立绘').length - 1, 1);
    assert.equal(set.split('igs-char-user-tag').length - 1, 1);
});

test('USER 立绘：本卡设置盖过全局，卡内清空也算', () => {
    const root = { userCharacter: '全局人', cards: { 'card:甲': { userCharacter: '白墨' }, 'card:乙': { userCharacter: '' } } };
    assert.equal(effectiveSceneAssets(root, 'card:甲').userCharacter, '白墨');
    assert.equal(effectiveSceneAssets(root, 'card:乙').userCharacter, '');
    assert.equal(effectiveSceneAssets(root, 'card:丙').userCharacter, '全局人');
});

function floorOf(lines, { userCharacter, userName = '林远' } = {}) {
    const assets = { enabled: true, userCharacter, characters: { 白墨: { 平和: 'u1' }, 小雪: { 平和: 'u3' } }, characterAliases: { 小雪: ['雪儿'] } };
    const raw = [], segments = [];
    for (const line of lines) {
        const said = line.match(/^(.+?)\|(.*?)\|(.+)$/);
        if (said) { raw.push(`[igs-char:${said[1]}|${said[2]}|${said[3]}]`); segments.push(`[${said[1]}]：${said[3]}`); }
        else { raw.push(line); segments.push(line); }
    }
    const source = raw.join('\n');
    const extracted = { sceneDirectives: extractSceneDirectives(source).directives, markerLayoutSource: source };
    const readerSettings = { _sceneAssets: assets, stageCast: { enabled: true } };
    const floor = prepareReaderFloor({ text: segments.join('\n'), segments, extracted, payload: { raw: source, recentCast: null }, scene: { speaker: '' }, readerSettings, userName });
    return { floor, assets };
}

test('USER 立绘：指定后旁白「你被小雪看到了」切到该角色立绘，用户名台词也归它', () => {
    const { floor, assets } = floorOf(['小雪|平和|早。', '你被小雪看到了。', '林远|平和|我来了。'], { userCharacter: '白墨' });
    assert.equal(floor.pages[1].spriteChar, '白墨');
    assert.equal(floor.keyOf('林远'), '白墨');
    assert.deepEqual(assets.characterAliases, { 小雪: ['雪儿'] }, '存储里的别名不被改动');
});

test('USER 立绘：未指定时行为不变；指定了不存在的角色等同未指定', () => {
    const lines = ['小雪|平和|早。', '你被小雪看到了。'];
    assert.notEqual(floorOf(lines, {}).floor.pages[1].spriteChar, '白墨');
    assert.equal(floorOf(lines, {}).floor.keyOf('林远'), '林远');
    assert.equal(floorOf(lines, { userCharacter: '不存在' }).floor.keyOf('林远'), '林远');
});

test('User立绘：「你」开头的旁白页换成主角；「你的」修饰不算；未指定时不换', () => {
    const lines = ['小雪|平和|早。', '你推开门，走进教室。', '你的书包掉在地上。'];
    const { floor } = floorOf(lines, { userCharacter: '白墨' });
    assert.equal(floor.pages[1].spriteChar, '白墨');
    assert.notEqual(floorOf(['小雪|平和|早。', '你的书包掉在地上。'], { userCharacter: '白墨' }).floor.pages[1].spriteChar, '白墨');
    assert.notEqual(floorOf(lines, {}).floor.pages[1].spriteChar, '白墨');
});
