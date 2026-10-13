import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryStorage } from '../src/index.js';
import { releasedGeneratedImageIds, unreferencedGeneratedImageIds } from '../src/visual/igs-ui/settings-actions.js';

// 旧版预设还没找回之前，它引用的图要留着；全局和各角色卡引用的同样留着。
test('gate:assets:image-refs-keep-global-cards-and-legacy-presets', () => {
    const storage = createMemoryStorage();
    storage.setItem('igs:scene-presets:v1', JSON.stringify({
        version: 1,
        presets: { 卡A: { scenes: { 教室: { url: 'igs-gen:bg-a', words: [], times: {} } }, characters: { 雪乃: { 默认: 'igs-gen:sp-a' } } } },
    }));
    assert.deepEqual(unreferencedGeneratedImageIds(['bg-a', 'sp-a', 'z'], { scenes: {}, characters: {} }, storage), ['z'], '旧预设引用的图不删');
    assert.deepEqual(releasedGeneratedImageIds(['sp-a', 'bg-a'], { characters: {} }, null), ['sp-a', 'bg-a']);
    assert.deepEqual(releasedGeneratedImageIds(['sp-a'], { characters: {} }, null), ['sp-a']);
    assert.deepEqual(unreferencedGeneratedImageIds(['x'], { cards: { 'card:小雪': { characters: { 小雪: { 默认: 'igs-gen:x' } } } } }, null), []);
});

test('gate:assets:story-outfit-pending-image-is-held-until-confirmed', async () => {
    const { saveStoryOutfitCandidate, removeStoryOutfitCandidate, storyOutfitId } = await import('../src/scene/outfit-review-store.js');
    const storage = createMemoryStorage();
    const row = { scopeKey: 'card:A', ownerKey: 'card:A', floorKey: 'chat|5|0', sourceHash: 'fixture',
        messageId: 5, character: 'Alice', word: 'Dress', prompt: 'wears a white dress', imageId: 'pending' };
    row.id = storyOutfitId(row);
    assert.equal(saveStoryOutfitCandidate(storage, row).ok, true);
    assert.deepEqual(unreferencedGeneratedImageIds(['pending', 'drop'], {}, storage), ['drop']);
    assert.deepEqual(releasedGeneratedImageIds(['pending', 'drop'], {}, storage), ['drop']);
    assert.equal(removeStoryOutfitCandidate(storage, row.id).ok, true);
    assert.deepEqual(releasedGeneratedImageIds(['pending'], { characterOutfits: { Alice: { Dress: {
        moods: { 平和: 'igs-gen:pending' } } } } }, storage), []);
    assert.deepEqual(releasedGeneratedImageIds(['pending'], {}, storage), ['pending']);
    storage.setItem('igs:story-outfit-review:v1', '{invalid');
    assert.deepEqual(unreferencedGeneratedImageIds(['pending'], {}, storage), [], '读取失败不冒充无人引用');
});
