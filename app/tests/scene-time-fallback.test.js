import { createAssetGenerationService } from './helpers/media-fixtures.js';
import test from 'node:test';
import assert from 'node:assert/strict';

import { sceneTimeBucket, sceneTimeKey } from '../src/scene/time-bucket.js';
import { sceneVariantTags } from '../src/generated-images/scene-variant-tags.js';
import { createMemoryGeneratedAssetStore } from '../src/media/generated-asset-store.js';
import { normalizeAutoIllustrationSettings } from '../src/generated-images/illustration/auto-illustration-settings.js';

test('gate:scene-time-fallback:words-map-into-the-four-buckets', () => {
    const cases = {
        白天: ['上午', '中午', '正午', '晌午', '午后', '下午', '午时', '巳时', '未时', '申时', 'midday', 'afternoon'],
        清晨: ['清晨', '早上', '早晨', '清早', '拂晓', '黎明', '破晓', '天亮', '卯时', '辰时', 'dawn'],
        黄昏: ['傍晚', '黄昏', '日落', '日暮', '暮色', '晚霞', '酉时', 'twilight'],
        夜晚: ['入夜', '晚上', '夜里', '深夜', '午夜', '凌晨', '半夜', '三更半夜', '子时', '丑时', '寅时', '戌时', '亥时', '五更'],
    };
    for (const [bucket, words] of Object.entries(cases)) {
        for (const word of words) assert.equal(sceneTimeBucket(word), bucket, word);
    }
    assert.equal(sceneTimeBucket('放学后'), '');
    assert.equal(sceneTimeBucket(''), '');
    assert.equal(sceneTimeKey('三更半夜'), 'midnight');
});

test('gate:scene-time-fallback:clock-times-map-by-hour', () => {
    const cases = {
        白天: ['14:30', '14：30', '2:30pm', '下午两点', '十点整', '中午12点', '中午1点', '上午12点', '14时30分', '3点', '三点', '1:00pm'],
        清晨: ['7am', '早上七点', '8点', '06:15', '上午8点'],
        黄昏: ['18:30', '晚上6点', '傍晚六点', '下午5点', '5点钟'],
        夜晚: ['晚上8点', '22:00', '凌晨三点半', '半夜两点', '深夜11点', '12am', '晚上12点', '二十三点', '00:10', '3:30'],
    };
    for (const [bucket, labels] of Object.entries(cases)) {
        for (const label of labels) assert.equal(sceneTimeBucket(label), bucket, label);
    }
    // 不是钟点的「一点」不误判
    assert.equal(sceneTimeBucket('有一点冷'), '');
    assert.equal(sceneTimeBucket('一点点'), '');
    assert.ok(sceneVariantTags('晚上8点', '').startsWith('night, night sky'));
    assert.ok(sceneVariantTags('14:30', '').startsWith('day, daylight'));
});

test('gate:scene-time-fallback:setting-defaults-on', () => {
    assert.equal(normalizeAutoIllustrationSettings({}).assets.dayFirst, true);
    assert.equal(normalizeAutoIllustrationSettings({ assets: { dayFirst: true } }).assets.dayFirst, true);
    assert.equal(normalizeAutoIllustrationSettings({ assets: { dayFirst: false } }).assets.dayFirst, false);
    assert.equal(normalizeAutoIllustrationSettings({ assets: { dayFirst: 'false' } }).assets.dayFirst, false);
});

const NO_SCENES = { enabled: true, scenes: {}, characters: {} };
const dayCaption = { v4_prompt: { caption: { base_caption: 'tavern, day, blue sky, wooden table', char_captions: [] } }, v4_negative_prompt: { caption: { base_caption: 'lowres', char_captions: [] } } };

function setup({ dayFirst = true, canCaption = true, texts = ['[igs-scene:酒馆|夜晚|晴]\n灯亮了。'] } = {}) {
    const store = createMemoryGeneratedAssetStore();
    const calls = [];
    const seeds = [];
    let id = 0;
    const floors = texts.map((text, index) => ({ chatId: 'c', messageId: index + 1, swipeId: 0, isAi: true, isLatest: true, text }));
    const nai = {
        describe: () => ({ mode: 'dbgen', via: 'dbgen', ownPrompts: canCaption, ready: { ok: true } }),
        async writeDbgenPrompt({ description }) { calls.push(['write', description]); return { ok: true, captions: [{ slotId: 1, caption: dayCaption }] }; },
        async generate(slot) { calls.push(['direct', slot.scene]); return { ok: true, dataUrl: 'data:image/png;base64,DIRECT' }; },
        ...(canCaption && {
            async generateDbgenCaption(meta) {
                const base = meta.caption.v4_prompt.caption.base_caption;
                calls.push(['caption', base]);
                seeds.push(meta.seed);
                return { ok: true, dataUrl: 'data:image/png;base64,X', prompt: { positive: base, negative: 'lowres' } };
            },
        }),
    };
    const service = createAssetGenerationService({
        messageHost: { getChatId: () => 'c', readFloor: (n) => floors[n - 1], readPreviousAiTexts: () => [] },
        llm: { async request() { return ''; } },
        nai,
        store,
        getSettings: () => ({ autoIllustration: { assets: { backgroundEnabled: true, ...(dayFirst !== undefined && { dayFirst }) } }, sceneAssets: NO_SCENES }),
        newId: () => `v${++id}`,
        minBodyChars: 0,
    });
    return { service, calls, seeds };
}

test('gate:scene-time-fallback:variant-reuses-day-base-seed', async () => {
    const { service, seeds } = setup();
    await service.processMessage(1);
    assert.equal(seeds.length, 2);
    assert.ok(Number.isInteger(seeds[0]) && seeds[0] > 0);
    assert.equal(seeds[1], seeds[0]);
});

test('gate:scene-time-fallback:night-scene-paints-day-base-then-variant', async () => {
    const { service, calls } = setup();
    const result = await service.processMessage(1);
    assert.equal(result.ok, true);
    assert.equal(result.count, 2);
    assert.deepEqual(calls.map((c) => c[0]), ['write', 'caption', 'caption']);
    assert.ok(calls[2][1].startsWith('night, night sky'));
    assert.ok(!/blue sky/.test(calls[2][1]) && calls[2][1].includes('wooden table'));
    const review = service.listReview('c|1|0');
    const day = review.find((r) => r.time === '白天');
    const night = review.find((r) => r.time === '夜晚');
    assert.ok(day && night);
    assert.equal(night.variantOf, day.imageId);
    // 再来一遍：白天底图和夜晚差分都已有，不再出图
    await service.processMessage(1, { manual: true });
    assert.equal(calls.filter((c) => c[0] === 'caption').length, 2);
});

test('gate:scene-time-fallback:day-base-is-reused-and-deduped-across-floors', async () => {
    const { service, calls } = setup({ texts: ['[igs-scene:酒馆|夜晚|晴]\n灯亮了。', '[igs-scene:酒馆|黄昏|晴]\n夕阳。'] });
    const [a, b] = await Promise.all([service.processMessage(1), service.processMessage(2)]);
    assert.deepEqual([a.ok, b.ok], [true, true]);
    assert.equal(calls.filter((c) => c[0] === 'write').length, 1);
    // 1 张白天 + 夜晚 + 黄昏差分
    assert.equal(calls.filter((c) => c[0] === 'caption').length, 3);
});

test('gate:scene-time-fallback:day-scene-and-switch-off-and-no-caption-backend-paint-directly', async () => {
    const day = setup({ texts: ['[igs-scene:酒馆|下午|晴]\n阳光。'] });
    await day.service.processMessage(1);
    assert.deepEqual(day.calls.map((c) => c[0]), ['write', 'caption']);

    const off = setup({ dayFirst: false });
    await off.service.processMessage(1);
    assert.deepEqual(off.calls.map((c) => c[0]), ['write', 'caption']);
    assert.equal(off.service.listReview('c|1|0').map((r) => r.time).join(), '夜晚');

    const noCaption = setup({ canCaption: false });
    const result = await noCaption.service.processMessage(1);
    assert.equal(result.ok, true);
    assert.deepEqual(noCaption.calls.map((c) => c[0]), ['direct']);
    assert.equal(noCaption.service.listReview('c|1|0').map((r) => r.time).join(), '夜晚');
}
);
