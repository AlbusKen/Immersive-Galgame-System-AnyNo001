
import test from 'node:test';
import assert from 'node:assert/strict';
import {
    extractSceneDirectives,
    stripIllustrationMarkers,
    resolveIllustrationAtSourceOffset,
    resolveHeldSourceOffset,
    locateNarrativeOffset,
    resolveHeldSourceOffsets,
    resolveIllustrationForPage,
} from '../src/scene/scene-directives.js';
import { buildIgsTextPayload } from '../src/scene/message-source.js';
import { bindCharacterDnaToCaption } from '../src/generated-images/illustration/auto-illustration-service.js';

test('gate:illustration:marker-does-not-shift-scene-directives', () => {
    const plain = '[igs-scene:卧室|夜晚|晴]\n[igs-char:小雪|开心|你好]\n一\n二';
    const withMarker = plain.replace('一\n', '一\n[igs-img:1]\n');
    const before = extractSceneDirectives(plain);
    const after = extractSceneDirectives(withMarker);
    assert.deepEqual(after.directives, before.directives);
    assert.equal(after.illustrationMarkers.length, 1);
    assert.equal(after.illustrationMarkers[0].slot, 1);
});

test('gate:illustration:database-img-marker-is-compatible-with-igs-marker', () => {
    const source = '[igs-scene:卧室|夜晚|晴]\n第一段。<IMG>1</IMG>\n第二段。';
    const extracted = extractSceneDirectives(source);
    assert.deepEqual(extracted.illustrationMarkers.map((marker) => marker.slot), [1]);
    assert.equal(stripIllustrationMarkers(source).includes('<IMG>'), false);
    assert.deepEqual(resolveIllustrationAtSourceOffset(source, source.indexOf('第二段')), { slot: 1, offset: source.indexOf('<IMG>') });
});

test('gate:illustration:broken-marker-does-not-hang', () => {
    assert.deepEqual(extractSceneDirectives('正文[igs-img:\n下一行[igs-img:x]').illustrationMarkers, []);
});

test('gate:illustration:strip-removes-own-line-and-inline', () => {
    assert.equal(stripIllustrationMarkers('a\n[igs-img:1]\nb[igs-img:2]c'), 'a\nbc');
});

test('gate:illustration:cg-is-the-marker-after-the-current-line', () => {
    const src = '对白1。\n对白2。\n对白3。\n[igs-img:1]\n对白4。\n对白5。\n对白6。\n[igs-img:2]\n对白7。\n对白8。\n对白9。\n[igs-img:3]';
    for (const line of ['对白1。', '对白2。', '对白3。']) {
        assert.equal(resolveIllustrationAtSourceOffset(src, src.indexOf(line)).slot, 1);
    }
    for (const line of ['对白4。', '对白5。', '对白6。']) {
        assert.equal(resolveIllustrationAtSourceOffset(src, src.indexOf(line)).slot, 2);
    }
    for (const line of ['对白7。', '对白8。', '对白9。']) {
        assert.equal(resolveIllustrationAtSourceOffset(src, src.indexOf(line)).slot, 3);
    }
});

test('gate:illustration:current-line-stays-in-the-story-copy', () => {
    const src = '<content>室内。\n[igs-char:星见|高潮|冬装|出してっ！全部。]\n[igs-img:1]\n下一句。</content>\n{"image_guidance":"出してっ！ 全部。"}';
    const segments = ['室内。', '出してっ！ 全部。', '下一句。'];
    const locate = (segment, from) => locateNarrativeOffset(src, segment, from, (slice, start) => {
        const needle = String(segment || '').trim();
        const exact = slice.indexOf(needle, Math.max(0, Number(start) || 0));
        if (exact >= 0) return exact;
        const loose = needle.replace(/[\s*（）\[\]]+/g, '');
        const flat = slice.slice(Math.max(0, Number(start) || 0)).replace(/[\s*（）\[\]]+/g, '');
        const hit = flat.indexOf(loose);
        if (hit < 0) return -1;
        return slice.indexOf('出してっ！', Math.max(0, Number(start) || 0));
    });
    const at = resolveHeldSourceOffset(src, segments, 1, locate);
    assert.ok(at >= 0 && at < src.indexOf('image_guidance'));
    assert.equal(resolveIllustrationAtSourceOffset(src, at).slot, 1);
    assert.equal(resolveIllustrationAtSourceOffset(src, resolveHeldSourceOffset(src, segments, 2, locate)).slot, 1);
});

test('gate:illustration:cg-stays-when-the-next-page-cannot-be-located', () => {
    const src = '前。\n[igs-img:1]\n灯还亮着。\n[igs-char:林小雨|平和|校服|你回来了。]\n她点头。\n[igs-img:2]\n雨停了。';
    const segments = ['前。', '灯还亮着。', '[林小雨]：你回来了。', '她点头。', '雨停了。'];
    const locate = (segment, from) => src.indexOf(String(segment || ''), Math.max(0, Number(from) || 0));
    assert.equal(resolveIllustrationAtSourceOffset(src, resolveHeldSourceOffset(src, segments, 0, locate)).slot, 1);
    assert.equal(resolveIllustrationAtSourceOffset(src, resolveHeldSourceOffset(src, segments, 1, locate)).slot, 2);
    assert.equal(resolveIllustrationAtSourceOffset(src, resolveHeldSourceOffset(src, segments, 2, locate)).slot, 2);
    assert.equal(resolveIllustrationAtSourceOffset(src, resolveHeldSourceOffset(src, segments, 3, locate)).slot, 2);
    assert.equal(resolveIllustrationAtSourceOffset(src, resolveHeldSourceOffset(src, segments, 4, locate)).slot, 2);
});

test('gate:illustration:cg-holds-until-the-next-cg', () => {
    const src = '[igs-scene:A|夜|晴]\n一\n[igs-img:1]\n二\n[igs-scene:B|夜|晴]\n三\n[igs-img:2]\n四';
    assert.equal(resolveIllustrationAtSourceOffset(src, src.indexOf('一')).slot, 1);
    assert.equal(resolveIllustrationAtSourceOffset(src, src.indexOf('二')).slot, 2);
    assert.equal(resolveIllustrationAtSourceOffset(src, src.indexOf('三')).slot, 2);
    assert.equal(resolveIllustrationAtSourceOffset(src, src.indexOf('四')).slot, 2);
});

test('gate:illustration:payload-keeps-raw-marker-but-hides-from-segments', () => {
    const payload = buildIgsTextPayload({ text: '<content>[igs-scene:A|夜|晴]\n一\n[igs-img:1]\n二</content>' });
    assert.ok(payload.raw.includes('[igs-img:1]'));
    assert.equal(payload.textSegments.some((segment) => segment.includes('igs-img')), false);
});

test('gate:illustration:nai-v4-request-shape', async () => {
    const { buildNaiV4Request, NAI_DEFAULT_NEGATIVE } = await import('../src/generated-images/request-builders/nai-v4-builder.js');
    const p = buildNaiV4Request({ scene: 'indoors, night', sceneUc: 'text', chars: [{ x: 0.33, y: 0.5, tags: '1girl, long hair', uc: 'bad hands' }] }, {}, () => 0).parameters;
    assert.equal(p.v4_prompt.use_coords, true);
    assert.equal(p.v4_prompt.use_order, true);
    assert.equal(p.v4_negative_prompt.legacy_uc, false);
    assert.deepEqual(p.v4_prompt.caption.char_captions[0].centers[0], { x: 0.3, y: 0.5 });
    assert.ok(p.negative_prompt.startsWith(NAI_DEFAULT_NEGATIVE));
    assert.ok(p.negative_prompt.includes('text'));
    assert.equal(p.seed, 0);
    assert.equal(p.width, 832);
});

test('gate:illustration:nai-v4-no-chars-disables-coords', async () => {
    const { buildNaiV4Request } = await import('../src/generated-images/request-builders/nai-v4-builder.js');
    const p = buildNaiV4Request({ scene: 'room', chars: [] }).parameters;
    assert.equal(p.use_coords, false);
    assert.equal(p.v4_prompt.use_coords, false);
    assert.deepEqual(p.v4_prompt.caption.char_captions, []);
});

test('gate:illustration:nai-artist-prefix-first', async () => {
    const { buildNaiV4Request } = await import('../src/generated-images/request-builders/nai-v4-builder.js');
    assert.ok(buildNaiV4Request({ scene: 'room' }, { artistPrefix: 'artist:foo' }).input.startsWith('artist:foo, '));
});

test('gate:illustration:nai-client-missing-key-no-request', async () => {
    const { createNaiOfficialClient } = await import('../src/generated-images/nai-official-client.js');
    let calls = 0;
    const result = await createNaiOfficialClient({ fetch: async () => { calls++; } }).generate({ scene: 'room' });
    assert.equal(result.ok, false);
    assert.equal(calls, 0);
});

test('gate:illustration:nai-client-proxy-url-and-auth', async () => {
    const { createNaiOfficialClient } = await import('../src/generated-images/nai-official-client.js');
    let request;
    const client = createNaiOfficialClient({ fetch: async (...args) => {
        request = args;
        return new Response(Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]), { status: 200, headers: { 'Content-Type': 'image/png' } });
    } });
    const result = await client.generate({ scene: 'room' }, { apiKey: 'k', transport: 'st-proxy' });
    assert.equal(request[0], '/proxy/https://image.novelai.net/ai/generate-image');
    assert.equal(request[1].headers.Authorization, 'Bearer k');
    assert.equal(result.ok, true);
    assert.ok(result.dataUrl.startsWith('data:image/'));
});

test('gate:illustration:nai-client-retries-429-once', async () => {
    const { createNaiOfficialClient } = await import('../src/generated-images/nai-official-client.js');
    let calls = 0;
    const client = createNaiOfficialClient({ fetch: async () => {
        calls++;
        return calls === 1 ? new Response('', { status: 429 }) : new Response(Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]), { status: 200, headers: { 'Content-Type': 'image/png' } });
    }, sleep: async () => {} });
    assert.equal((await client.generate({ scene: 'room' }, { apiKey: 'k' })).ok, true);
    assert.equal(calls, 2);
});

test('gate:illustration:nai-client-error-hides-key', async () => {
    const { createNaiOfficialClient } = await import('../src/generated-images/nai-official-client.js');
    const result = await createNaiOfficialClient({ fetch: async () => new Response('', { status: 401 }) }).generate({ scene: 'room' }, { apiKey: 'private-key' });
    assert.equal(result.ok, false);
    assert.ok(!result.error.includes('private-key'));
});

test('gate:illustration:number-paragraphs-reads-directives', async () => {
    const { numberParagraphs } = await import('../src/generated-images/illustration/marker-placer.js');
    const result = numberParagraphs('思维链\n<content>\n[igs-scene:卧室|夜晚|晴|NSFW]\n月光洒进来。\n[igs-char:小雪|害羞|别看我……]\n</content>\n状态栏');
    assert.equal(result.paragraphs.length, 2);
    assert.equal(result.paragraphs[1].text, '小雪：「别看我……」');
    assert.equal(result.isNsfw, true);
    assert.ok(result.characters.includes('小雪'));
});

test('gate:illustration:later-scene-nsfw-still-triggers', async () => {
    const { numberParagraphs } = await import('../src/generated-images/illustration/marker-placer.js');
    const split = [
        '<content>',
        '[igs-scene:教室|白天|晴]',
        '上课。',
        '</content>',
        '<content>',
        '[igs-scene:卧室|夜晚|晴|NSFW]',
        '她关上门。',
        '</content>',
    ].join('\n');
    const afterClose = '<content>\n[igs-scene:教室|白天|晴]\n上课。\n</content>\n[igs-scene:卧室|夜晚|晴|NSFW]\n她关上门。';
    for (const text of [split, afterClose]) {
        const result = numberParagraphs(text);
        assert.equal(result.isNsfw, true);
        assert.deepEqual(result.scenes.map((scene) => scene.scene), ['教室', '卧室']);
    }
});

test('gate:illustration:anchor-uses-the-same-match-as-dbgen', async () => {
    const { numberParagraphs, paragraphNoForAnchor } = await import('../src/generated-images/illustration/marker-placer.js');
    const raw = [
        '[igs-scene:卧室|夜晚|晴|NSFW]',
        '她推开门，看见灯还亮着。',
        '[igs-char:林小雨|平和|校服|你回来了。]',
        '林小雨把外套脱在椅背上，换上了睡衣。',
        '窗外的雨忽然大了。',
    ].join('\n');
    const numbered = numberParagraphs(raw);
    assert.equal(paragraphNoForAnchor(raw, numbered.paragraphs, '她推开门，看见灯还亮着。'), 1);
    assert.equal(paragraphNoForAnchor(raw, numbered.paragraphs, '你回来了'), 2);
    assert.equal(paragraphNoForAnchor(raw, numbered.paragraphs, '“换上了睡衣”'), 3);
    assert.equal(paragraphNoForAnchor(raw, numbered.paragraphs, '结尾改写了，窗外的雨忽然大了，前面也改了'), 4);
    assert.equal(paragraphNoForAnchor(raw, numbered.paragraphs, '完全对不上的另一段话'), 0);
});

test('gate:illustration:anchors-in-one-paragraph-stay-on-their-own-sentences', async () => {
    const { insertMarkersAtAnchors } = await import('../src/generated-images/illustration/marker-placer.js');
    const raw = '前文。黒いエナメルの長い耳が、彼女の頭上でピンと立っている。中文。親指の腹で、張り詰めた乳頭をそっと転がす。后文。';
    const result = insertMarkersAtAnchors(raw, [
        { slot: 4, anchorSentence: '黒いエナメルの長い耳が、彼女の頭上でピンと立っている。' },
        { slot: 3, anchorSentence: '親指の腹で、張り詰めた乳頭をそっと転がす。' },
    ]);
    const ear = result.indexOf('立っている。');
    const thumb = result.indexOf('転がす。');
    assert.ok(ear >= 0 && thumb > ear);
    assert.ok(result.indexOf('[igs-img:4]') > ear);
    assert.ok(result.indexOf('[igs-img:4]') < thumb);
    assert.ok(result.indexOf('[igs-img:3]') > thumb);
    assert.equal(result.includes('[igs-img:4]\n[igs-img:3]'), false);
});

test('gate:illustration:insert-marker-before-paragraph', async () => {
    const { numberParagraphs, insertMarkers } = await import('../src/generated-images/illustration/marker-placer.js');
    const raw = '[igs-scene:A|夜|晴]\n一\n二\n三';
    const result = insertMarkers(raw, numberParagraphs(raw).paragraphs, [{ slot: 1, at: 2 }, { slot: 2, at: 3 }]);
    assert.ok(result.includes('一\n[igs-img:1]\n二\n[igs-img:2]\n三'));
});

test('gate:illustration:insert-marker-after-leading-scene-tag', async () => {
    const { numberParagraphs, insertMarkers } = await import('../src/generated-images/illustration/marker-placer.js');
    const raw = '[igs-scene:A|夜|晴]正文';
    const result = insertMarkers(raw, numberParagraphs(raw).paragraphs, [{ slot: 1, at: 1 }]);
    assert.equal(result, '[igs-scene:A|夜|晴][igs-img:1]正文');
    assert.equal(resolveIllustrationAtSourceOffset(result, result.indexOf('正文')).slot, 1);
});

test('gate:illustration:parse-multi-slot', async () => {
    const { parseIllustrationPlan } = await import('../src/generated-images/illustration/planner-parser.js');
    const result = parseIllustrationPlan('slot: 1\nat: 1\nscene: indoors\nchar: 0.33,0.5 | 1girl\nchar_uc: bad hands\nslot: 2\nat: 3\nscene: outdoors', { maxSlots: 2, paragraphCount: 3 });
    assert.equal(result.slots.length, 2);
    assert.equal(result.slots[0].chars[0].x, 0.3);
    assert.equal(result.slots[0].chars[0].uc, 'bad hands');
});

test('gate:illustration:parse-tolerates-garbage', async () => {
    const { parseIllustrationPlan } = await import('../src/generated-images/illustration/planner-parser.js');
    const result = parseIllustrationPlan('```\nslot：1\nat：99\nscene：room\nslot：2\nat：1\nscene：street\nslot：3\nat：1\nscene：garden\n```', { maxSlots: 3, paragraphCount: 2 });
    assert.ok(result.slots.length <= 3);
    assert.ok(result.slots.every(({ at }) => at >= 1 && at <= 2));
    assert.equal(new Set(result.slots.map(({ at }) => at)).size, result.slots.length);
});

test('gate:illustration:parse-crowded-tail-keeps-count', async () => {
    const { parseIllustrationPlan } = await import('../src/generated-images/illustration/planner-parser.js');
    const result = parseIllustrationPlan('slot: 1\nat: 10\nscene: a\nslot: 2\nat: 10\nscene: b\nslot: 3\nat: 10\nscene: c', { maxSlots: 3, paragraphCount: 10 });
    assert.equal(result.slots.length, 3);
    assert.deepEqual(result.slots.map(({ at }) => at), [8, 9, 10]);
});

test('gate:illustration:parse-empty-fails', async () => {
    const { parseIllustrationPlan } = await import('../src/generated-images/illustration/planner-parser.js');
    assert.equal(parseIllustrationPlan('抱歉我不能').ok, false);
});

test('gate:illustration:planner-prompt-count-wording', async () => {
    const { buildPlannerUserPrompt } = await import('../src/generated-images/illustration/planner-prompt.js');
    assert.ok(buildPlannerUserPrompt({ want: 2, exact: true }).includes('恰好 2 张'));
    assert.ok(buildPlannerUserPrompt({ want: 1, exact: true, frame: '画面是竖的，宽832，高1216。构图按竖屏写，不要写成横屏。' }).includes('【画面】画面是竖的，宽832，高1216。'));
    assert.ok(buildPlannerUserPrompt({ want: 3, exact: false }).includes('1 到 3 张'));
});

test('gate:illustration:memory-store-roundtrip', async () => {
    const { floorKeyOf, slotKeyOf, createMemoryIllustrationStore } = await import('../src/media/illustration-store.js');
    const store = createMemoryIllustrationStore();
    const floor = { chatId: 'chat', messageId: 2, swipeId: 1 };
    const key = floorKeyOf(floor);
    assert.equal(key, 'chat|2|1');
    assert.equal(slotKeyOf(floor, 2), `${key}|2`);
    await store.putFloor(key, { kind: 'nsfw', status: 'planning' });
    await store.putSlot(key, { slot: 2, scene: 'room', status: 'done' });
    await store.putSlot(key, { slot: 1, scene: 'hall', status: 'pending' });
    const retrieved = await store.getFloor(key);
    retrieved.status = 'failed';
    assert.equal((await store.getFloor(key)).status, 'planning');
    const slots = await store.getSlots(key);
    assert.deepEqual(slots.map((s) => s.slot), [1, 2]);
    slots[0].scene = 'mutated';
    assert.equal((await store.getSlots(key))[0].scene, 'hall');
});

test('gate:illustration:secondary-llm-openai-url-and-body', async () => {
    const { createSecondaryLlm } = await import('../src/host/secondary-llm.js');
    let url;
    let body;
    const llm = createSecondaryLlm({}, { fetch: async (target, init) => {
        url = target;
        body = JSON.parse(init.body);
        return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), { status: 200 });
    } });
    assert.equal(await llm.request({ system: 'sys', user: 'usr' }, { source: 'openai', endpoint: 'https://x.com/v1', model: 'm' }), 'ok');
    assert.equal(url, 'https://x.com/v1/chat/completions');
    assert.equal(body.messages[0].role, 'system');
});

test('gate:illustration:secondary-llm-fetch-models', async () => {
    const { createSecondaryLlm } = await import('../src/host/secondary-llm.js');
    const calls = [];
    const llm = createSecondaryLlm({}, { fetch: async (url, init) => {
        calls.push({ url, method: init.method, auth: init.headers.Authorization });
        return new Response(JSON.stringify({ data: [{ id: 'model-a' }, { id: 'model-b' }, { id: 'model-a' }] }), { status: 200 });
    } });
    const result = await llm.fetchModels({ endpoint: 'https://example.com/v1', apiKey: 'fake-key' });
    assert.deepEqual(result.models, ['model-a', 'model-b']);
    assert.deepEqual(calls, [{ url: 'https://example.com/v1/models', method: 'GET', auth: 'Bearer fake-key' }]);
    const empty = createSecondaryLlm({}, { fetch: async () => new Response(JSON.stringify({ data: [] }), { status: 200 }) });
    await assert.rejects(empty.fetchModels({ endpoint: 'https://example.com/v1' }), /未返回可用模型/);
    let count = 0;
    const missing = createSecondaryLlm({}, { fetch: async () => { count += 1; throw new Error('unexpected'); } });
    await assert.rejects(missing.fetchModels({}), /填写副 LLM 地址/);
    assert.equal(count, 0);
});

test('gate:illustration:secondary-llm-prefers-tavernhelper', async () => {
    const { createSecondaryLlm } = await import('../src/host/secondary-llm.js');
    let captured;
    const llm = createSecondaryLlm({ TavernHelper: { generateRaw: async (value) => { captured = value; return 'r'; } } });
    assert.equal(await llm.request({ system: 'sys', user: 'usr' }, { source: 'tavern' }), 'r');
    assert.equal(captured.ordered_prompts.length, 2);
});

test('gate:illustration:secondary-llm-timeout', async () => {
    const { createSecondaryLlm } = await import('../src/host/secondary-llm.js');
    const llm = createSecondaryLlm({ TavernHelper: { generateRaw: () => new Promise(() => {}) } });
    await assert.rejects(llm.request({ system: 'sys', user: 'usr' }, { timeoutMs: 20 }), /超时/);
});

test('gate:illustration:message-host-write-fallback', async () => {
    const { createIllustrationMessageHost } = await import('../src/host/illustration-message-host.js');
    let called = false;
    let saved = false;
    const ctx = { chat: [{ mes: 'a', swipe_id: 0, swipes: ['a'] }], updateMessageBlock() { called = true; }, async saveChat() { saved = true; } };
    const host = createIllustrationMessageHost({ SillyTavern: { getContext: () => ctx } });
    assert.equal((await host.writeFloor(0, 'b')).ok, true);
    assert.equal(ctx.chat[0].mes, 'b');
    assert.equal(ctx.chat[0].swipes[0], 'b');
    assert.ok(called && saved);
});

test('gate:illustration:message-host-rejects-stale-floor-before-helper-write', async () => {
    const { createIllustrationMessageHost } = await import('../src/host/illustration-message-host.js');
    const ctx = {
        chatId: 'chat-1',
        chat: [{ mes: 'original', is_user: false, swipe_id: 0 }],
    };
    let writes = 0;
    const host = createIllustrationMessageHost({
        SillyTavern: { getContext: () => ctx },
        TavernHelper: { setChatMessages: async () => { writes++; } },
    });
    const expected = host.readFloor(0);
    ctx.chat.push({ mes: 'next', is_user: true });
    assert.equal((await host.writeFloor(0, 'updated', expected)).reason, 'stale');
    ctx.chat.pop();
    ctx.chat[0].swipe_id = 1;
    assert.equal((await host.writeFloor(0, 'updated', expected)).reason, 'stale');
    ctx.chat[0].swipe_id = 0;
    ctx.chatId = 'chat-2';
    assert.equal((await host.writeFloor(0, 'updated', expected)).reason, 'stale');
    assert.equal(writes, 0);
    assert.equal(ctx.chat[0].mes, 'original');
});

const NSFW_TEXT = '[igs-scene:卧室|夜晚|晴|NSFW]\n一段。\n二段。\n三段。';
const SFW_TEXT = '[igs-scene:街道|白天|晴]\n一段。\n二段。';
const REPLY = 'slot: 1\nat: 2\nscene: 1girl, bedroom\nchar: 0.5,0.5 | 1girl, black hair';

test('gate:illustration:prompt-ready-strips-markers', async () => {
    const { createIllustrationMessageHost } = await import('../src/host/illustration-message-host.js');
    const handlers = new Map();

    const ctx = { eventTypes: { CHAT_COMPLETION_PROMPT_READY: 'ready' }, eventSource: { on: (key, fn) => handlers.set(key, fn), off: (key) => handlers.delete(key) } };
    const host = createIllustrationMessageHost({ SillyTavern: { getContext: () => ctx } });
    host.attachPromptStrip();
    const payload = { chat: [{ role: 'assistant', content: 'a\n[igs-img:1]\nb' }] };
    handlers.get('ready')(payload);
    assert.equal(payload.chat[0].content, 'a\nb');
    const databasePayload = { chat: [{ role: 'assistant', content: 'a\n<IMG>1</IMG>\nb' }] };
    handlers.get('ready')(databasePayload);
    assert.equal(databasePayload.chat[0].content, 'a\nb');
    host.destroy();
});

test('gate:illustration:regex-install-idempotent', async () => {
    const { createIllustrationMessageHost } = await import('../src/host/illustration-message-host.js');
    let scripts = [{ id: 'user', destination: { display: true, prompt: true } }];
    const helper = {
        getTavernRegexes: () => scripts,
        replaceTavernRegexes: async (next) => { scripts = next; },
    };
    const regexHost = createIllustrationMessageHost({ TavernHelper: helper });
    assert.equal((await regexHost.ensureMarkerRegexes()).ok, true);
    assert.equal((await regexHost.ensureMarkerRegexes()).ok, true);
    assert.equal(scripts.length, 3);
    assert.ok(scripts.some(({ id }) => id === 'user'));
    assert.equal(scripts.some(({ destination }) => !destination.display && !destination.prompt), false);
    assert.ok(scripts.find(({ id }) => id === 'igs-illustration-marker-display').find_regex.includes('<IMG>'));
});

function makeFakes({ text, isLatest = true, llmReply = REPLY, naiResult, settings = {} }) {
    const calls = { llm: 0, nai: 0, writes: [], events: [] };
    let current = text;
    const messageHost = {
        getChatId: () => 'c1',
        readFloor: () => ({ chatId: 'c1', messageId: 5, swipeId: 0, isAi: true, isLatest, text: current }),
        readPreviousAiTexts: () => [],
        writeFloor: async (id, next) => { calls.writes.push(next); current = next; return { ok: true }; },
        on: () => () => {}, attachPromptStrip: () => {},
        ensureMarkerRegexes: async () => ({ ok: true }), destroy: () => {},
        setText: (textValue) => { current = textValue; },
    };
    const llm = { request: async () => {
        calls.llm++;
        if (llmReply instanceof Error) throw llmReply;
        return llmReply;
    } };
    const nai = { generate: async () => { calls.nai++; return naiResult || { ok: true, dataUrl: 'data:image/png;base64,AAAA' }; } };
    const events = { emit: (type, payload) => calls.events.push({ type, payload }) };
    // 这批用例的正文都只有几个字，专测流程；「少于 50 字不自动生图」单独测。
    return { calls, messageHost, llm, nai, events, getSettings: () => settings, minBodyChars: 0 };
}

const LONG_LINE = '她靠在窗边，看着外面的雨一点点停下来，城市的灯光一盏接一盏地亮起。';

test('gate:illustration:skips-auto-when-body-under-50-chars', async () => {
    const { createAutoIllustrationService } = await import('../src/generated-images/illustration/auto-illustration-service.js');
    const { createMemoryIllustrationStore } = await import('../src/media/illustration-store.js');
    const reports = [];
    const fakes = makeFakes({ text: NSFW_TEXT, settings: { nsfwEnabled: true } });
    const service = createAutoIllustrationService({ ...fakes, minBodyChars: undefined, store: createMemoryIllustrationStore(), report: (level, msg) => reports.push(msg) });
    assert.equal((await service.processMessage(5)).reason, 'body-too-short');
    assert.match(reports.join('\n'), /第 5 楼跳过：正文只有 9 字，少于 50 字不自动生图/);
    // 思考、状态栏写得再长也不算正文。
    fakes.messageHost.setText(`<thinking>${LONG_LINE.repeat(3)}</thinking>\n${NSFW_TEXT}`);
    assert.equal((await service.processMessage(5)).reason, 'body-too-short');
    fakes.messageHost.setText(`<content>\n${NSFW_TEXT}\n</content>\n<Status_block>${LONG_LINE.repeat(3)}</Status_block>`);
    assert.equal((await service.processMessage(5)).reason, 'body-too-short');
    assert.equal(fakes.calls.llm, 0, '正文只有几个字时不规划、不生图');
    // 跳过不记成已处理：同一楼「继续」写长后照常规划。
    fakes.messageHost.setText(`${NSFW_TEXT}\n${LONG_LINE.repeat(2)}`);
    assert.notEqual((await service.processMessage(5)).reason, 'body-too-short');
    assert.ok(fakes.calls.llm > 0, '正文够长照常规划');
    const manual = makeFakes({ text: NSFW_TEXT, settings: { nsfwEnabled: true } });
    await createAutoIllustrationService({ ...manual, minBodyChars: undefined, store: createMemoryIllustrationStore() }).processMessage(5, { manual: true });
    assert.ok(manual.calls.llm > 0, '手动生成不看字数');
});

test('gate:illustration:body-length-follows-reader-source-filter', async () => {
    const { floorBodyLength } = await import('../src/generated-images/illustration/floor-body-length.js');
    // 台词 / 心理只数说出口的那句，角色名、表情、服装栏和指令不算。
    assert.equal(floorBodyLength('[igs-scene:卧室|夜晚|晴]\n[igs-char:艾莉|微笑|你好。]\n[igs-thought:艾莉|平静|校服|好困。]\n[igs-fx:shake]\n她笑了。'), 10);
    assert.equal(floorBodyLength('【igs-char：艾莉｜微笑｜你好。】\n[igs-img:1]\n<IMG>2</IMG>'), 3);
    // 保留标签在就只数里面；在但为空就是 0；整楼没有保留标签时退回去掉排除块后的全文。
    assert.equal(floorBodyLength(`<thinking>${LONG_LINE}</thinking>\n<content>\n短。\n</content>\n<Status_block>${LONG_LINE}</Status_block>`), 2);
    assert.equal(floorBodyLength(`<content>\n\n</content>\n${LONG_LINE}`), 0);
    assert.equal(floorBodyLength(`<thinking>${LONG_LINE}</thinking>\n短。`), 2);
    assert.equal(floorBodyLength(`<bbi_image>1girl, rain</bbi_image>\nimage###1girl###\n短。`), 2);
    // 用户改过正文过滤规则时跟着改。
    assert.equal(floorBodyLength(`<story>短。</story>\n${LONG_LINE}`, { textIncludeTags: 'story' }), 2);
    assert.equal(floorBodyLength(`<thinking>${LONG_LINE}</thinking>`, { enabled: false }), LONG_LINE.length);
});

test('gate:illustration:service-disabled-makes-no-calls', async () => {
    const { createAutoIllustrationService } = await import('../src/generated-images/illustration/auto-illustration-service.js');
    const { createMemoryIllustrationStore } = await import('../src/media/illustration-store.js');
    const store = createMemoryIllustrationStore();
    const fake = makeFakes({ text: NSFW_TEXT });
    const result = await createAutoIllustrationService({ ...fake, store }).processMessage(5);
    assert.equal(result.reason, 'disabled');
    assert.equal(fake.calls.llm + fake.calls.nai + fake.calls.writes.length, 0);
    assert.equal(await store.getFloor('c1|5|0'), null);
});

test('gate:illustration:service-skips-non-latest-floor', async () => {
    const { createAutoIllustrationService } = await import('../src/generated-images/illustration/auto-illustration-service.js');
    const { createMemoryIllustrationStore } = await import('../src/media/illustration-store.js');
    const fake = makeFakes({ text: NSFW_TEXT, isLatest: false, settings: { nsfwEnabled: true } });
    assert.equal((await createAutoIllustrationService({ ...fake, store: createMemoryIllustrationStore() }).processMessage(5)).reason, 'not-eligible');
    assert.equal(fake.calls.llm + fake.calls.nai, 0);
});

test('gate:illustration:service-nsfw-generates-and-writes-marker', async () => {
    const { createAutoIllustrationService, ILLUSTRATION_UPDATED_EVENT } = await import('../src/generated-images/illustration/auto-illustration-service.js');
    const { createMemoryIllustrationStore } = await import('../src/media/illustration-store.js');
    const store = createMemoryIllustrationStore();
    const fake = makeFakes({ text: NSFW_TEXT, settings: { nsfwEnabled: true, nsfwCount: 1 } });
    const service = createAutoIllustrationService({ ...fake, store });
    assert.equal((await service.processMessage(5)).reason, 'done');
    assert.ok(fake.calls.writes[0].includes('\n[igs-img:1]\n二段。'));
    assert.equal(fake.calls.nai, 1);
    assert.equal((await store.getSlots('c1|5|0'))[0].status, 'done');
    assert.ok(fake.calls.events.some(({ type }) => type === ILLUSTRATION_UPDATED_EVENT));
    assert.equal(service.getIllustrationUrl({ messageId: 5, slot: 1 }), 'data:image/png;base64,AAAA');
});

test('gate:illustration:embedded-cg-uses-host-box-not-window', async () => {
    const { readCgViewport, cgSizeForMode } = await import('../src/generated-images/illustration/auto-illustration-service.js');
    const host = { getBoundingClientRect: () => ({ width: 818, height: 511 }) };
    const globalObject = {
        innerWidth: 865,
        innerHeight: 962,
        document: { querySelector: (selector) => (selector === '.igs-embedded-host' ? host : null) },
    };
    const viewport = readCgViewport(globalObject);
    assert.deepEqual(viewport, { width: 818, height: 511 });
    assert.equal(cgSizeForMode('1216x832', 'embedded', viewport), '1216x832');
    assert.deepEqual(readCgViewport({ innerWidth: 865, innerHeight: 962, document: { querySelector: () => null } }), { width: 865, height: 962 });
    assert.deepEqual(readCgViewport(globalObject, 'fullscreen'), { width: 865, height: 962 });
    assert.deepEqual(readCgViewport({
        innerWidth: 400,
        innerHeight: 800,
        visualViewport: { width: 844, height: 390 },
        document: { querySelector: () => host },
    }, 'fullscreen'), { width: 844, height: 390 });
});

test('gate:illustration:cg-size-swaps-on-mobile', async () => {
    const { cgSizeForMode, cgFramePrompt } = await import('../src/generated-images/illustration/auto-illustration-service.js');
    assert.equal(cgFramePrompt('1216x832'), '画面是横的，宽1216，高832。构图按横屏写，不要写成竖屏。');
    assert.equal(cgFramePrompt('832x1216'), '画面是竖的，宽832，高1216。构图按竖屏写，不要写成横屏。');
    assert.equal(cgSizeForMode('1216x832', 'pc'), '1216x832');
    assert.equal(cgSizeForMode('1216x832', 'fullscreen'), '1216x832');
    assert.equal(cgSizeForMode('1216x832', 'fullscreen', { width: 390, height: 844 }), '640x1408');
    assert.equal(cgSizeForMode('1216x832', 'fullscreen', { width: 844, height: 390 }), '1408x640');
    assert.equal(cgSizeForMode('1216x832', 'fullscreen', { width: 390, height: 220 }), '1344x768');
    assert.equal(cgSizeForMode('1216x832', 'fullscreen', { portrait: true, width: 900, height: 1600 }), '768x1344');
    assert.equal(cgSizeForMode('1216x832', 'fullscreen', { width: 1280, height: 720 }), '1344x768');
    assert.equal(cgSizeForMode('1216x832', 'fullscreen', { width: 1920, height: 1080 }), '1344x768');
    assert.equal(cgSizeForMode('640x640', 'fullscreen', { width: 1920, height: 1080 }), '832x448');
    const pixels = (size) => size.split('x').map(Number).reduce((a, b) => a * b, 1);
    assert.equal(cgSizeForMode('1216x832', 'fullscreen', { width: 1728, height: 576 }), '1728x576');
    assert.equal(pixels(cgSizeForMode('1216x832', 'fullscreen', { width: 1728, height: 576 })), 995328);
    assert.ok(pixels(cgSizeForMode('1920x1088', 'fullscreen', { width: 3440, height: 1440 })) <= 1048576);
    assert.ok(pixels(cgSizeForMode('1920x1088', 'fullscreen')) <= 1048576);
    assert.ok(pixels(cgSizeForMode('2048x2048', 'fullscreen', { width: 21, height: 9 })) <= 1048576);
    assert.equal(cgSizeForMode('1216x832', 'web'), '1216x832');
    assert.equal(cgSizeForMode('1216x832', 'mobile'), '832x1216');
    assert.ok(pixels(cgSizeForMode('1920x1088', 'pc')) <= 1048576);
    assert.ok(pixels(cgSizeForMode('1920x1088', 'web')) <= 1048576);
    assert.ok(pixels(cgSizeForMode('1920x1088', 'mobile')) <= 1048576);
    assert.ok(pixels(cgSizeForMode('2048x1536', 'embedded', { width: 1280, height: 720 })) <= 1048576);
    const { buildNaiV4Request } = await import('../src/generated-images/request-builders/nai-v4-builder.js');
    for (const size of ['1920x1088', '1536x1024', '2048x2048', '832x1216']) {
        const body = buildNaiV4Request({ scene: 'room' }, { size });
        assert.ok(body.parameters.width * body.parameters.height <= 1048576, size);
    }
    assert.equal(cgSizeForMode('', 'mobile'), '832x1216');
    assert.equal(cgSizeForMode('1216x832', 'embedded', { width: 390, height: 844 }), '832x1216');
    assert.equal(cgSizeForMode('1216x832', 'embedded', { width: 390, height: 220 }), '832x1216');
    assert.equal(cgSizeForMode('1216x832', 'embedded', { width: 1280, height: 720 }), '1216x832');
    assert.equal(cgSizeForMode('1216x832', 'embedded', { width: 818, height: 511 }), '1216x832');
});

test('gate:illustration:dbgen-cg-calls-only-the-plugin-prompt-and-generate-apis', async () => {
    const { createAutoIllustrationService } = await import('../src/generated-images/illustration/auto-illustration-service.js');
    const { createMemoryIllustrationStore } = await import('../src/media/illustration-store.js');
    const calls = { llm: 0, generate: 0, floor: [], paint: [] };
    let current = NSFW_TEXT;
    const caption = { v4_prompt: { caption: { base_caption: 'cg', char_captions: [] } }, v4_negative_prompt: { caption: { base_caption: '', char_captions: [] } } };
    const messageHost = {
        getChatId: () => 'c1',
        readFloor: () => ({ chatId: 'c1', messageId: 5, swipeId: 0, isAi: true, isLatest: true, text: current }),
        readPreviousAiTexts: () => [],
        writeFloor: async (_id, next) => { current = next; return { ok: true }; },
        on: () => () => {}, attachPromptStrip: () => {},
        ensureMarkerRegexes: async () => ({ ok: true }), destroy: () => {},
    };
    const nai = {
        describe: () => ({ via: 'dbgen', ownPrompts: true, ready: { ok: true } }),
        generate: async () => { calls.generate += 1; return { ok: true }; },
        writeDbgenFloorPrompts: async (req) => {
            calls.floor.push(req);
            return { ok: true, captions: [{ slotId: 1, caption, anchorSentence: '二段。' }, { slotId: 2, caption, anchorSentence: '三段。' }] };
        },
        generateDbgenCaption: async (req) => { calls.paint.push(req); return { ok: true, dataUrl: 'data:image/png;base64,Q0c=' }; },
    };
    const llm = { request: async () => { calls.llm += 1; return REPLY; } };
    const service = createAutoIllustrationService({
        messageHost, llm, nai, events: { emit() {} },
        store: createMemoryIllustrationStore(),
        getSettings: () => ({ nsfwEnabled: true, nsfwCount: 1 }),
        minBodyChars: 0,
    });
    const result = await service.processMessage(5);
    assert.equal(result.reason, 'done');
    assert.equal(calls.llm, 0);
    assert.equal(calls.generate, 0);
    assert.equal(calls.floor.length, 1);
    assert.equal(calls.floor[0].messageId, 5);
    assert.equal(calls.floor[0].description, '为本楼生成1张CG，CG点自行选择。slotid沿用本次召回分配的编号，不重新从1开始。挂载点只从剧情正文里逐字摘原句，提示词、出图指导、标签和正文以外的内容不要拿来当挂载点，也不要画进CG。\n画面是横的，宽1216，高832。构图按横屏写，不要写成竖屏。');
    assert.equal(calls.floor[0].skipRecall, undefined);
    assert.equal(calls.paint.length, 1);
    assert.equal(calls.paint[0].caption, caption);
    assert.equal(calls.paint[0].size, '1216x832');
    assert.ok(current.includes('[igs-img:1]'));
    assert.ok(current.indexOf('二段。') < current.indexOf('[igs-img:1]'));
    assert.ok(current.indexOf('[igs-img:1]') < current.indexOf('三段。'));
    assert.equal(service.getIllustrationUrl({ messageId: 5, slot: 1 }), 'data:image/png;base64,Q0c=');
});

test('gate:illustration:service-nsfw-off-never-rolls-interlude', async () => {
    const { createAutoIllustrationService } = await import('../src/generated-images/illustration/auto-illustration-service.js');
    const { createMemoryIllustrationStore } = await import('../src/media/illustration-store.js');
    const fake = makeFakes({ text: NSFW_TEXT, settings: { interludeEnabled: true, interludeProbability: 100 } });
    await createAutoIllustrationService({ ...fake, store: createMemoryIllustrationStore(), random: () => 0 }).processMessage(5);
    assert.equal(fake.calls.llm + fake.calls.nai, 0);
});

test('gate:illustration:service-interlude-probability-gate', async () => {
    const { createAutoIllustrationService } = await import('../src/generated-images/illustration/auto-illustration-service.js');
    const { createMemoryIllustrationStore } = await import('../src/media/illustration-store.js');
    for (const [probability, selected] of [[30, false], [60, true]]) {
        const store = createMemoryIllustrationStore();
        const fake = makeFakes({ text: SFW_TEXT, settings: { interludeEnabled: true, interludeProbability: probability } });
        await createAutoIllustrationService({ ...fake, store, random: () => 0.5 }).processMessage(5);
        assert.equal(fake.calls.llm, selected ? 1 : 0);
        if (!selected) assert.equal((await store.getFloor('c1|5|0')).kind, 'none');
    }
});

test('gate:illustration:service-decided-floor-not-replanned', async () => {
    const { createAutoIllustrationService } = await import('../src/generated-images/illustration/auto-illustration-service.js');
    const { createMemoryIllustrationStore } = await import('../src/media/illustration-store.js');
    const fake = makeFakes({ text: NSFW_TEXT, settings: { nsfwEnabled: true } });
    const store = createMemoryIllustrationStore();
    const service = createAutoIllustrationService({ ...fake, store });
    await service.processMessage(5);
    await service.processMessage(5);
    await createAutoIllustrationService({ ...fake, store }).processMessage(5);
    assert.equal(fake.calls.llm, 1);
});

test('gate:illustration:service-concurrent-calls-share-lock', async () => {
    const { createAutoIllustrationService } = await import('../src/generated-images/illustration/auto-illustration-service.js');
    const { createMemoryIllustrationStore } = await import('../src/media/illustration-store.js');
    const fake = makeFakes({ text: NSFW_TEXT, settings: { nsfwEnabled: true } });
    const service = createAutoIllustrationService({ ...fake, store: createMemoryIllustrationStore() });
    await Promise.all([service.processMessage(5), service.processMessage(5)]);
    assert.equal(fake.calls.llm, 1);
});

test('gate:illustration:service-llm-failure-no-write', async () => {
    const { createAutoIllustrationService } = await import('../src/generated-images/illustration/auto-illustration-service.js');
    const { createMemoryIllustrationStore } = await import('../src/media/illustration-store.js');
    const fake = makeFakes({ text: NSFW_TEXT, settings: { nsfwEnabled: true }, llmReply: new Error('x') });
    const store = createMemoryIllustrationStore();
    const service = createAutoIllustrationService({ ...fake, store });
    assert.equal((await service.processMessage(5)).reason, 'plan-failed');
    assert.equal(fake.calls.writes.length, 0);
    assert.equal((await store.getFloor('c1|5|0')).status, 'failed');
    assert.equal(service.getIllustrationUrl({ messageId: 5, slot: 1 }), '');
});

test('gate:illustration:service-stale-text-aborts', async () => {
    const { createAutoIllustrationService } = await import('../src/generated-images/illustration/auto-illustration-service.js');
    const { createMemoryIllustrationStore } = await import('../src/media/illustration-store.js');
    const fake = makeFakes({ text: NSFW_TEXT, settings: { nsfwEnabled: true } });
    fake.llm.request = async () => { fake.messageHost.setText('被用户改了'); return REPLY; };
    const store = createMemoryIllustrationStore();
    assert.equal((await createAutoIllustrationService({ ...fake, store }).processMessage(5)).reason, 'stale');
    assert.equal(fake.calls.writes.length, 0);
    assert.equal((await store.getFloor('c1|5|0')).status, 'stale');
});

test('gate:illustration:service-tail-append-during-planning-still-writes', async () => {
    const { createAutoIllustrationService } = await import('../src/generated-images/illustration/auto-illustration-service.js');
    const { createMemoryIllustrationStore } = await import('../src/media/illustration-store.js');
    const fake = makeFakes({ text: NSFW_TEXT, settings: { nsfwEnabled: true } });
    const tail = '\n\n<parallel>与此同时，另一边……</parallel>';
    fake.llm.request = async () => { fake.messageHost.setText(NSFW_TEXT + tail); return REPLY; };
    const store = createMemoryIllustrationStore();
    const result = await createAutoIllustrationService({ ...fake, store }).processMessage(5);
    assert.equal(result.ok, true);
    assert.equal(fake.calls.writes.length, 1);
    assert.ok(fake.calls.writes[0].includes('[igs-img:1]'));
    assert.ok(fake.calls.writes[0].endsWith(tail), '追加的平行事件原样保留在末尾');
    assert.ok(fake.calls.writes[0].indexOf('[igs-img:1]') < fake.calls.writes[0].indexOf('<parallel>'));
});

test('gate:illustration:appended-tail-only-accepts-pure-append', async () => {
    const { appendedTail, reattachTail } = await import('../src/generated-images/illustration/marker-placer.js');
    assert.equal(appendedTail('甲\n乙', '甲\n乙'), '');
    assert.equal(appendedTail('甲\n乙', '甲\n乙\n丙'), '\n丙');
    assert.equal(appendedTail('甲\n乙\n', '甲\n乙\n\n丙'), '\n\n丙', '原文结尾空白被改写也算追加');
    assert.equal(appendedTail('甲\n乙', '甲\n改\n丙'), null);
    assert.equal(appendedTail('甲\n乙', '前\n甲\n乙'), null);
    assert.equal(appendedTail('', '丙'), null);
    assert.equal(reattachTail('[igs-img:1]\n甲\n', '\n丙'), '[igs-img:1]\n甲\n丙');
    assert.equal(reattachTail('甲', ''), '甲');
});

test('gate:illustration:service-stale-when-new-floor-arrives-during-planning', async () => {
    const { createAutoIllustrationService } = await import('../src/generated-images/illustration/auto-illustration-service.js');
    const { createMemoryIllustrationStore } = await import('../src/media/illustration-store.js');
    const fake = makeFakes({ text: NSFW_TEXT, settings: { nsfwEnabled: true } });
    const originalReadFloor = fake.messageHost.readFloor;
    let latest = true;
    fake.messageHost.readFloor = (...args) => ({ ...originalReadFloor(...args), isLatest: latest });
    fake.llm.request = async () => { latest = false; return REPLY; };
    const store = createMemoryIllustrationStore();
    const result = await createAutoIllustrationService({ ...fake, store }).processMessage(5);
    assert.equal(result.reason, 'stale');
    assert.equal(fake.calls.writes.length, 0);
    assert.equal(fake.calls.nai, 0);
    assert.equal((await store.getFloor('c1|5|0')).status, 'stale');
});

test('gate:illustration:service-stale-during-regex-setup-skips-write-and-nai', async () => {
    const { createAutoIllustrationService } = await import('../src/generated-images/illustration/auto-illustration-service.js');
    const { createIllustrationMessageHost } = await import('../src/host/illustration-message-host.js');
    const { createMemoryIllustrationStore } = await import('../src/media/illustration-store.js');
    const ctx = { chatId: 'c1', chat: Array.from({ length: 5 }, () => ({ is_user: true, mes: 'user' })) };
    ctx.chat.push({ mes: NSFW_TEXT, is_user: false, swipe_id: 0 });
    let writes = 0;
    let naiCalls = 0;
    const host = createIllustrationMessageHost({ SillyTavern: { getContext: () => ctx }, TavernHelper: {
        setChatMessages: async () => { writes++; },
    } });
    host.ensureMarkerRegexes = async () => {
        ctx.chat.push({ mes: 'new message', is_user: true });
        return { ok: true };
    };
    const store = createMemoryIllustrationStore();
    const result = await createAutoIllustrationService({ messageHost: host, store,
        llm: { request: async () => REPLY }, nai: { generate: async () => { naiCalls++; } },
        getSettings: () => ({ nsfwEnabled: true }), minBodyChars: 0,
    }).processMessage(5);
    assert.equal(result.reason, 'stale');
    assert.equal((await store.getFloor('c1|5|0')).status, 'stale');
    assert.equal(writes + naiCalls, 0);
});

test('gate:illustration:service-nai-failure-marks-slot-failed', async () => {
    const { createAutoIllustrationService } = await import('../src/generated-images/illustration/auto-illustration-service.js');
    const { createMemoryIllustrationStore } = await import('../src/media/illustration-store.js');
    const fake = makeFakes({ text: NSFW_TEXT, settings: { nsfwEnabled: true }, naiResult: { ok: false, error: 'x' } });
    const store = createMemoryIllustrationStore();
    const service = createAutoIllustrationService({ ...fake, store });
    await service.processMessage(5);
    assert.equal(fake.calls.writes.length, 1);
    assert.equal((await store.getSlots('c1|5|0'))[0].status, 'failed');
    assert.equal(service.getIllustrationUrl({ messageId: 5, slot: 1 }), '');
});

test('gate:illustration:get-url-hydrates-from-store', async () => {
    const { createAutoIllustrationService } = await import('../src/generated-images/illustration/auto-illustration-service.js');
    const { createMemoryIllustrationStore } = await import('../src/media/illustration-store.js');
    const fake = makeFakes({ text: NSFW_TEXT });
    const store = createMemoryIllustrationStore();
    await store.putSlot('c1|5|0', { slot: 1, status: 'done', dataUrl: 'data:image/png;base64,AAAA' });
    const service = createAutoIllustrationService({ ...fake, store });
    assert.equal(service.getIllustrationUrl({ messageId: 5, slot: 1 }), '');
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(service.getIllustrationUrl({ messageId: 5, slot: 1 }), 'data:image/png;base64,AAAA');
    assert.equal(fake.calls.events.length, 1);
});

test('gate:illustration:settings-normalize-clamps', async () => {
    const { normalizeAutoIllustrationSettings } = await import('../src/generated-images/illustration/auto-illustration-settings.js');
    const settings = normalizeAutoIllustrationSettings({ nsfwEnabled: 'true', nsfwCount: 9, interludeProbability: -5, interludeMaxCount: '16', assets: { maxPerFloor: '16' }, llm: { source: 'x' } });
    assert.equal(settings.nsfwEnabled, true);
    assert.equal(settings.nsfwCount, 9);
    assert.equal(normalizeAutoIllustrationSettings({ nsfwCount: 2 }).nsfwCount, 2);
    assert.equal(normalizeAutoIllustrationSettings({ nsfwCount: 99 }).nsfwCount, 16);
    assert.equal(settings.interludeMaxCount, 16);
    assert.equal(settings.assets.maxPerFloor, 16);
    const capped = normalizeAutoIllustrationSettings({ interludeMaxCount: 99, assets: { maxPerFloor: 99 } });
    assert.deepEqual([capped.interludeMaxCount, capped.assets.maxPerFloor], [16, 16]);
    const defaults = normalizeAutoIllustrationSettings({});
    assert.deepEqual([defaults.interludeMaxCount, defaults.assets.maxPerFloor], [1, 2]);
    assert.equal(settings.interludeProbability, 0);
    assert.equal(settings.llm.source, 'tavern');
    assert.equal(normalizeAutoIllustrationSettings({}).nsfwEnabled, false);
    assert.equal(normalizeAutoIllustrationSettings({}).interludeEnabled, false);
});

test('gate:illustration:settings-value-types', async () => {
    const { normalizeSettingsValue } = await import('../src/visual/igs-ui/settings-normalize.js');
    assert.equal(normalizeSettingsValue('bridge.autoIllustration.nsfwEnabled', 'true'), true);
    assert.equal(normalizeSettingsValue('bridge.autoIllustration.interludeEnabled', 'false'), false);
    assert.equal(normalizeSettingsValue('bridge.autoIllustration.interludeProbability', '45'), 45);
    assert.equal(normalizeSettingsValue('bridge.autoIllustration.nai.scale', '5.5'), 5.5);
    assert.equal(normalizeSettingsValue('bridge.autoIllustration.llm.source', 'openai'), 'openai');
});

test('gate:illustration:failed-floor-retries-and-reports-real-error', async () => {
    const { createAutoIllustrationService } = await import('../src/generated-images/illustration/auto-illustration-service.js');
    const { createSecondaryLlm } = await import('../src/host/secondary-llm.js');
    const { createMemoryIllustrationStore } = await import('../src/media/illustration-store.js');
    const chat = [{ is_user: true, mes: 'hi' }, { mes: '[igs-scene:卧室|夜晚|晴|nsfw]\n她走进房间。', swipe_id: 0 }];
    const host = {
        readFloor: (id) => ({ chatId: 'c', messageId: id, swipeId: 0, isAi: true, isLatest: id === chat.length - 1, text: chat[id].mes }),
        readPreviousAiTexts: () => [], writeFloor: async (id, text) => { chat[id].mes = text; return { ok: true }; },
        ensureMarkerRegexes: async () => ({ ok: true }), getChatId: () => 'c',
    };
    let online = false;
    const fetch = async () => {
        if (!online) throw new TypeError('Failed to fetch');
        return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'slot: 1\nat: 1\nscene: 1girl, bedroom' } }] }) };
    };
    const reports = [];
    const naiCalls = [];
    const svc = createAutoIllustrationService({
        messageHost: host, llm: createSecondaryLlm({}, { fetch }), store: createMemoryIllustrationStore(),
        nai: { generate: async (slot) => { naiCalls.push(slot); return { ok: true, dataUrl: 'data:image/png;base64,x' }; } },
        getSettings: () => ({ nsfwEnabled: true, llm: { source: 'openai', endpoint: 'https://llm.example/v1', model: 'm', prompts: { illustration: 'CUSTOM' } } }),
        report: (level, message) => reports.push({ level, message }),
        minBodyChars: 0,
    });
    const first = await svc.processMessage(1);
    assert.equal(first.reason, 'plan-failed');
    assert.match(first.error, /CORS/);
    assert.ok(reports.some((r) => r.level === 'error' && /未发送生图请求/.test(r.message)));
    online = true;
    const second = await svc.processMessage(1);
    assert.equal(second.reason, 'done');
    assert.equal(naiCalls.length, 1);
    assert.equal((await svc.processMessage(1)).reason, 'already-decided');
});

test('gate:illustration:custom-llm-prompt-used-and-empty-falls-back', async () => {
    const { normalizeAutoIllustrationSettings, DEFAULT_LLM_PROMPTS } = await import('../src/generated-images/illustration/auto-illustration-settings.js');
    const s = normalizeAutoIllustrationSettings({ llm: { prompts: { illustration: ' mine ', asset: '   ' } } });
    assert.equal(s.llm.prompts.illustration, 'mine');
    assert.equal(s.llm.prompts.asset, DEFAULT_LLM_PROMPTS.asset);
    assert.equal(s.llm.prompts.illustrationSoft, DEFAULT_LLM_PROMPTS.illustrationSoft);
});

test('gate:illustration:image-job-log-retention-and-clear', async () => {
    const { createImageJobLog, IMAGE_JOB_LOG_STORAGE_KEY } = await import('../src/generated-images/image-job-log.js');
    const store = new Map();
    const storage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)) };
    let clock = Date.UTC(2026, 0, 10);
    let settings = { retainDays: 1, maxEntries: 50 };
    const log = createImageJobLog({ storage, now: () => clock, getSettings: () => settings });
    let changes = 0;
    log.onChange(() => { changes += 1; });
    log.add('error', 'old');
    clock += 2 * 24 * 60 * 60 * 1000;
    log.add('info', 'new');
    assert.deepEqual(log.list().map((e) => e.message), ['new']);
    for (let i = 0; i < 60; i += 1) log.add('info', `n${i}`);
    assert.equal(log.list().length, 50);
    assert.equal(log.list()[0].message, 'n59');
    const reloaded = createImageJobLog({ storage, now: () => clock, getSettings: () => settings });
    assert.equal(reloaded.list().length, 50);
    settings = { retainDays: 0, maxEntries: 50 };
    assert.equal(log.clear().removed, 50);
    assert.equal(JSON.parse(store.get(IMAGE_JOB_LOG_STORAGE_KEY)).length, 0);
    assert.ok(changes > 0);
});

test('gate:illustration:nai-provider-official-url-uses-builtin-models', async () => {
    const { naiProvider } = await import('../src/generated-images/providers/nai-provider.js');
    const { NAI_OFFICIAL_MODELS } = await import('../src/generated-images/request-builders/nai-v4-builder.js');
    let count = 0;
    const result = await naiProvider.fetchModels({}, {
        unifiedSettings: { bridge: { imageApi: { mode: 'nai', apiUrl: 'https://image.novelai.net/ai/generate-image' } } },
        fetch: async () => { count += 1; throw new Error('unexpected'); },
    });
    assert.equal(count, 0);
    assert.deepEqual(result.models, [...NAI_OFFICIAL_MODELS]);
});

test('gate:illustration:nai-client-uses-custom-endpoint-or-official', async () => {
    const { createNaiOfficialClient, NAI_OFFICIAL_ENDPOINT } = await import('../src/generated-images/nai-official-client.js');
    const urls = [];
    const client = createNaiOfficialClient({ fetch: async (url) => { urls.push(url); return new Response('', { status: 401 }); } });
    const slot = { scene: 'room' };
    await client.generate(slot, { apiKey: 'fake-key' });
    await client.generate(slot, { apiKey: 'fake-key', endpoint: ' https://nai.example.com/custom/generate ' });
    await client.generate(slot, { apiKey: 'fake-key', endpoint: 'https://nai.example.com/x', transport: 'st-proxy' });
    assert.deepEqual(urls, [NAI_OFFICIAL_ENDPOINT, 'https://nai.example.com/custom/generate', '/proxy/https://nai.example.com/x']);
});

test('gate:illustration:service-retries-database-img-marker-without-replanning', async () => {
    const { createAutoIllustrationService } = await import('../src/generated-images/illustration/auto-illustration-service.js');
    const { createMemoryIllustrationStore } = await import('../src/media/illustration-store.js');
    const fake = makeFakes({
        text: NSFW_TEXT.replace('[igs-scene:卧室|夜晚|晴|NSFW]\n', '[igs-scene:卧室|夜晚|晴|NSFW]\n<IMG>1</IMG>\n'),
        settings: { nsfwEnabled: true, nsfwCount: 1 },
    });
    const store = createMemoryIllustrationStore();
    await store.putFloor('c1|5|0', { kind: 'nsfw', want: 1, status: 'failed' });
    await store.putSlot('c1|5|0', { slot: 1, scene: 'room', status: 'failed' });
    const service = createAutoIllustrationService({ ...fake, store });
    const result = await service.processMessage(5);
    assert.equal(result.reason, 'done');
    assert.equal(fake.calls.llm, 0);
    assert.equal(fake.calls.writes.length, 0);
    assert.equal(fake.calls.nai, 1);
    assert.equal(service.getIllustrationUrl({ messageId: 5, slot: 1 }), 'data:image/png;base64,AAAA');
});


test('gate:illustration:failed-slot-retries-without-replanning', async () => {
    const { createAutoIllustrationService } = await import('../src/generated-images/illustration/auto-illustration-service.js');
    const { createMemoryIllustrationStore } = await import('../src/media/illustration-store.js');
    const fake = makeFakes({ text: NSFW_TEXT, settings: { nsfwEnabled: true, nsfwCount: 1 }, naiResult: { ok: false, error: 'NAI 服务端错误（HTTP 500）' } });
    const store = createMemoryIllustrationStore();
    const service = createAutoIllustrationService({ ...fake, store });
    const first = await service.processMessage(5);
    assert.equal(first.reason, 'generation-failed');
    assert.match(first.error, /HTTP 500/);
    assert.equal((await store.getFloor('c1|5|0')).status, 'failed');
    fake.nai.generate = async () => { fake.calls.nai++; return { ok: true, dataUrl: 'data:image/png;base64,BBBB' }; };
    const retry = await service.processMessage(5, { manual: true });
    assert.deepEqual([retry.reason, fake.calls.llm, fake.calls.writes.length], ['done', 1, 1]);
    assert.equal(service.getIllustrationUrl({ messageId: 5, slot: 1 }), 'data:image/png;base64,BBBB');
    assert.equal((await service.processMessage(5, { manual: true })).reason, 'nothing-missing');
});

test('gate:illustration:manual-interlude-ignores-probability', async () => {
    const { createAutoIllustrationService } = await import('../src/generated-images/illustration/auto-illustration-service.js');
    const { createMemoryIllustrationStore } = await import('../src/media/illustration-store.js');
    const fake = makeFakes({ text: SFW_TEXT, settings: { interludeEnabled: true, interludeProbability: 0 } });
    const store = createMemoryIllustrationStore();
    const service = createAutoIllustrationService({ ...fake, store, random: () => 0.99 });
    assert.equal((await service.processMessage(5)).reason, 'not-selected');
    assert.equal((await service.processMessage(5, { manual: true })).reason, 'done');
    assert.equal(fake.calls.llm, 1);
});

test('gate:illustration:slot-count-mismatch-still-generates', async () => {
    const { createAutoIllustrationService } = await import('../src/generated-images/illustration/auto-illustration-service.js');
    const { createMemoryIllustrationStore } = await import('../src/media/illustration-store.js');
    const fake = makeFakes({ text: NSFW_TEXT, settings: { nsfwEnabled: true, nsfwCount: 2 } });
    const result = await createAutoIllustrationService({ ...fake, store: createMemoryIllustrationStore() }).processMessage(5);
    assert.equal(result.reason, 'done');
    assert.equal(fake.calls.nai, 1);
});

function cgSlots(src, segments, opts = {}) {
    const offsets = resolveHeldSourceOffsets(src, segments);
    return segments.map((_, index) => {
        const hit = resolveIllustrationForPage({ source: src, offsets, segments, index, holdPages: 2, ...opts });
        return hit ? hit.slot : 0;
    });
}

test('gate:illustration:sfw-cg-enters-at-anchor-and-leaves-after-hold', () => {
    const segments = ['甲。', '乙。', '丙。', '丁。', '戊。', '己。', '庚。'];
    const src = '[igs-scene:教室|午后|晴]\n甲。\n乙。\n[igs-img:1]\n丙。\n丁。\n戊。\n己。\n庚。';
    // 锚句「乙」所在页切入，不提前；无人开口时最长保持 holdPages*2 页。
    assert.deepEqual(cgSlots(src, segments), [0, 1, 1, 1, 1, 0, 0]);
});

test('gate:illustration:sfw-cg-leaves-when-a-new-speaker-talks', () => {
    const segments = ['甲。', '[小雪]：嗯。', '丙。', '[小雪]：好。', '[林]：喂。', '丁。'];
    const src = '[igs-scene:教室|午后|晴]\n甲。\n[igs-char:小雪|开心|嗯。]\n[igs-img:1]\n丙。\n[igs-char:小雪|开心|好。]\n[igs-char:林|平和|喂。]\n丁。';
    assert.deepEqual(cgSlots(src, segments), [0, 1, 1, 1, 0, 0]);
});

test('gate:illustration:sfw-cg-leaves-on-scene-change-and-next-cg-takes-over', () => {
    const segments = ['甲。', '乙。', '丙。', '丁。', '戊。'];
    const src = '[igs-scene:教室|午后|晴]\n甲。\n[igs-img:1]\n[igs-scene:走廊|午后|晴]\n乙。\n丙。\n[igs-img:2]\n丁。\n戊。';
    assert.deepEqual(cgSlots(src, segments), [1, 0, 2, 2, 2]);
});

test('gate:illustration:nsfw-cg-keeps-floor-wide-behaviour', () => {
    const segments = ['甲。', '乙。', '丙。', '丁。', '戊。', '己。', '庚。'];
    const src = '[igs-scene:卧室|夜晚|晴|NSFW]\n甲。\n乙。\n[igs-img:1]\n丙。\n丁。\n戊。\n己。\n庚。';
    assert.deepEqual(cgSlots(src, segments), [1, 1, 1, 1, 1, 1, 1]);
    // 本楼没写场景时沿用上一楼的 NSFW 状态。
    assert.deepEqual(cgSlots(src.replace(/^.*\n/, ''), segments, { inheritedNsfw: true }), [1, 1, 1, 1, 1, 1, 1]);
});

test('数据库生图 CG：单人且上下文唯一角色时 DNA 并进 char caption，多人不注入', () => {
    const assets = { characters: { 小雪: {} }, characterAliases: {}, characterDna: { 小雪: { triggerWords: 'xiaoxue', identity: '1girl, white hair', negative: 'short hair' } } };
    const caption = (n) => ({
        v4_prompt: { caption: { base_caption: 'room', char_captions: Array.from({ length: n }, () => ({ char_caption: 'smile', centers: [{ x: 0.5, y: 0.5 }] })) } },
        v4_negative_prompt: { caption: { base_caption: 'bad', char_captions: [] } },
    });
    const single = bindCharacterDnaToCaption(caption(1), assets, ['小雪'], 1);
    assert.equal(single.caption.v4_prompt.caption.char_captions[0].char_caption, 'xiaoxue, 1girl, white hair, smile');
    assert.equal(single.caption.v4_negative_prompt.caption.char_captions[0].char_caption, 'short hair');
    assert.deepEqual(single.caption.v4_negative_prompt.caption.char_captions[0].centers, [{ x: 0.5, y: 0.5 }]);
    const pair = bindCharacterDnaToCaption(caption(2), assets, ['小雪'], 2);
    assert.equal(pair.caption.v4_prompt.caption.char_captions[0].char_caption, 'smile');
    assert.equal(pair.warnings.length, 1);
});

// 平行事件插件在 AI 楼后面另插一条（隐藏的系统消息或旁白楼）：这楼仍算最新楼，立绘、场景、CG 照常生成；用户发言后才不算。
test('gate:illustration:message-host-latest-ignores-plugin-floors-after-ai', async () => {
    const { createIllustrationMessageHost } = await import('../src/host/illustration-message-host.js');
    const ctx = { chatId: 'c1', chat: [{ mes: 'u', is_user: true }, { mes: 'ai', is_user: false }, { mes: '平行事件', is_user: false, is_system: true }, { mes: '旁白', is_user: false }] };
    const host = createIllustrationMessageHost({ SillyTavern: { getContext: () => ctx } });
    assert.equal(host.readFloor(1).isLatest, true);
    ctx.chat.push({ mes: '下一句', is_user: true });
    assert.equal(host.readFloor(1).isLatest, false);
});

// 规划期间正文开头 / 中间被插了内容：标记按前后文搬到新正文，照常出图；对不上的那张丢掉。
test('gate:illustration:service-mid-edit-during-planning-transplants-markers', async () => {
    const { createAutoIllustrationService } = await import('../src/generated-images/illustration/auto-illustration-service.js');
    const { createMemoryIllustrationStore } = await import('../src/media/illustration-store.js');
    const fake = makeFakes({ text: NSFW_TEXT, settings: { nsfwEnabled: true } });
    const head = '<parallel>与此同时，另一边……</parallel>\n';
    fake.llm.request = async () => { fake.messageHost.setText(head + NSFW_TEXT); return REPLY; };
    const store = createMemoryIllustrationStore();
    const result = await createAutoIllustrationService({ ...fake, store }).processMessage(5);
    assert.equal(result.ok, true);
    assert.equal(fake.calls.writes.length, 1);
    assert.ok(fake.calls.writes[0].startsWith(head), '插件插的内容原样保留');
    assert.ok(fake.calls.writes[0].includes('\n[igs-img:1]\n二段。'));
    assert.equal(fake.calls.nai, 1);
});

test('gate:illustration:transplant-markers-follows-context', async () => {
    const { transplantMarkers } = await import('../src/generated-images/illustration/marker-placer.js');
    const moved = transplantMarkers('甲段落一句。\n[igs-img:1]\n乙段落二句。\n丙三。\n[igs-img:2]', '【平行事件】别处。\n甲段落一句。\n乙段落二句改过。\n丙三。\n<状态栏>');
    assert.deepEqual(moved.slots, [1, 2]);
    assert.equal(moved.text, '【平行事件】别处。\n甲段落一句。\n[igs-img:1]\n乙段落二句改过。\n丙三。\n[igs-img:2]\n<状态栏>');
    assert.deepEqual(transplantMarkers('甲。\n[igs-img:1]\n乙。', '完全不同的内容').slots, []);
});

test('gate:illustration:backfill-old-floor-only-when-enabled-and-not-yet-decided', async () => {
    const { createAutoIllustrationService } = await import('../src/generated-images/illustration/auto-illustration-service.js');
    const { createMemoryIllustrationStore } = await import('../src/media/illustration-store.js');
    const off = makeFakes({ text: NSFW_TEXT, isLatest: false, settings: { nsfwEnabled: true } });
    assert.equal((await createAutoIllustrationService({ ...off, store: createMemoryIllustrationStore() }).processMessage(5, { backfill: true })).reason, 'disabled', '开关默认关');
    assert.equal(off.calls.llm + off.calls.nai, 0);
    const fake = makeFakes({ text: NSFW_TEXT, isLatest: false, settings: { nsfwEnabled: true, nsfwCount: 1, backfillOldFloors: true } });
    const service = createAutoIllustrationService({ ...fake, store: createMemoryIllustrationStore() });
    assert.equal((await service.processMessage(5)).reason, 'not-eligible', '自动出图仍只认最新楼');
    assert.equal((await service.processMessage(5, { backfill: true })).reason, 'done');
    assert.ok(fake.calls.writes[0].includes('[igs-img:1]'));
    assert.equal((await service.processMessage(5, { backfill: true })).reason, 'already-decided', '补过的楼不再画');
    assert.equal(fake.calls.nai, 1);
});

test('gate:cg-bindings:real-slot-ids-and-metadata-survive-generation', async () => {
    for (const count of [2, 3]) {
        const run = await runBoundCgFixture((f) => [
            { slotId: 7, caption: f.caption, characterMeta: f.characterMeta, anchorSentence: '三段。' },
            { slotId: 6, caption: f.caption, characterMeta: f.characterMeta, anchorSentence: '二段。' },
        ], count);
        assert.equal(run.result.ok, true);
        assert.equal(run.writes.length, 1);
        assert.equal(run.writes[0].characterContext.length, count);
        assert.equal(run.fake.calls.llm, 0);
        const records = await run.store.getSlots('c1|5|0');
        assert.deepEqual(records.map((r) => r.slot), [6, 7]);
        assert.deepEqual(records[0].characterMeta, run.paints[0].characterMeta);
        assert.deepEqual(records[0].caption, run.paints[0].caption);
        assert.deepEqual(records[0].originalSize, { width: 1216, height: 832 });
        assert.match(run.fake.calls.writes[0], /\[igs-img:6\]/);
        assert.match(run.fake.calls.writes[0], /\[igs-img:7\]/);
    }
});

test('gate:cg-bindings:missing-duplicate-id-and-invalid-meta-do-not-paint', async () => {
    for (const entries of [
        (f) => [{ caption: f.caption, anchorSentence: '二段。' }],
        (f) => [6, 6].map((slotId) => ({ slotId, caption: f.caption, anchorSentence: '二段。' })),
        (f) => [{ slotId: 6, caption: f.caption, anchorSentence: '二段。', characterMeta: { version: 2 } }],
        (f) => [{ slotId: 6, caption: f.caption, anchorSentence: '' }],
    ]) {
        const run = await runBoundCgFixture(entries);
        assert.equal(run.result.ok, false);
        assert.equal(run.paints.length, 0);
        assert.equal(run.fake.calls.writes.length, 0);
    }
    const legacy = await runBoundCgFixture((f) => [{ slotId: 6, caption: f.caption, anchorSentence: '二段。' }]);
    assert.equal(legacy.result.ok, true);
    assert.equal((await legacy.store.getSlots('c1|5|0'))[0].characterMeta, undefined);
});


test('gate:cg-bindings:outfit-snapshot-follows-anchor-and-nearest-floor', async () => {
    const { cgCharacterState } = await import('../src/generated-images/illustration/cg-character-bindings.js');
    const f = cgBindingFixture();
    f.assets.characterOutfits = { Alice: { Coat: { words: [], moods: {}, wardrobe: 'coat' }, Dress: { words: [], moods: {}, wardrobe: 'dress' } } };
    f.assets.wardrobe = { coat: { prompt: 'A blue coat.' }, dress: { prompt: 'A white dress.' } };
    const text = '[igs-scene:Cafe|day|sunny]\n[igs-char:A|smile|Coat|Hello]\nFirst moment.\n[igs-char:A|smile|Dress|Later]\nSecond moment.';
    const state = cgCharacterState(text, f.names, f.assets);
    assert.equal(state.at(text.indexOf('First moment.') + 13)[0].outfit.name, 'Coat');
    assert.equal(state.at(Infinity)[0].outfit.name, 'Dress');
    const inherited = cgCharacterState('No new outfit.', f.names, f.assets,
        ['[igs-char:A|smile|Coat|Old]', '[igs-char:A|smile|Dress|Recent]']);
    assert.equal(inherited.context[0].outfit.description, 'A white dress.');
});

test('gate:cg-bindings:parser-default-center-is-not-explicit-position', async () => {
    const { parseIllustrationPlan } = await import('../src/generated-images/illustration/planner-parser.js');
    const parsed = parseIllustrationPlan('scene: Cafe.\nchar: Alice | 0.3,0.5 | Alice smiles.\nchar: Bob smiles.\nchar: Carol | 9,0.5 | Carol smiles.');
    assert.deepEqual(parsed.slots[0].chars.map((c) => c.positionExplicit), [true, false, false]);
});

async function runBoundCgFixture(entries, count = 2) {
    const { createAutoIllustrationService } = await import('../src/generated-images/illustration/auto-illustration-service.js');
    const { createMemoryIllustrationStore } = await import('../src/media/illustration-store.js');
    const f = cgBindingFixture(count);
    const fake = makeFakes({ text: NSFW_TEXT + '\n' + f.names.map((name) => `[igs-char:${name}|smile|Hello]`).join('\n'), settings: { nsfwEnabled: true, nsfwCount: 2 } });
    const writes = [], paints = [];
    fake.nai.describe = () => ({ via: 'dbgen', ready: { ok: true } });
    fake.nai.writeDbgenFloorPrompts = async (req) => { writes.push(req); return { ok: true, captions: entries(f) }; };
    fake.nai.generateDbgenCaption = async (req) => { paints.push(req); return { ok: true, dataUrl: 'data:image/png;base64,Q0c=', caption: req.caption, characterMeta: req.characterMeta }; };
    const store = createMemoryIllustrationStore();
    const result = await createAutoIllustrationService({ ...fake, store, getSceneAssets: () => f.assets }).processMessage(5);
    return { result, store, writes, paints, fake };
}

function cgBindingFixture(count = 2) {
    const names = ['Alice', 'Bob', 'Carol'].slice(0, count);
    const caption = { v4_prompt: { caption: { base_caption: 'Friends meet in a cafe.',
        char_captions: names.map((name, i) => ({ char_caption: `${name} smiles.`, centers: [{ x: (i + 1) / (count + 1), y: 0.5 }] })) } },
        v4_negative_prompt: { caption: { base_caption: '', char_captions: [] } } };
    const characterMeta = { version: 1, characters: names.map((name, i) => ({ characterKey: name, captionIndex: i,
        identityAnchor: `${name} has fixed features.`, signatureDetails: 'A small mole.',
        outfit: { name: 'Coat', description: 'A blue coat.' },
        centers: caption.v4_prompt.caption.char_captions[i].centers, positionExplicit: true })).reverse() };
    const assets = { characters: Object.fromEntries(names.map((name) => [name, { 默认: `igs-gen:${name}` }])),
        characterAliases: { Alice: ['A'] }, characterDna: Object.fromEntries(names.map((name) => [name, { identity: `${name} identity.`, negative: `${name} wrong identity.` }])) };
    return { names, caption, characterMeta, assets };
}

test('gate:cg-bindings:two-and-three-characters-bind-by-key-not-array-order', async () => {
    const { bindCgCaption } = await import('../src/generated-images/illustration/cg-character-bindings.js');
    const { buildCharacterContext } = await import('../src/scene/character-identity.js');
    for (const count of [2, 3]) {
        const f = cgBindingFixture(count);
        const context = buildCharacterContext(['A', ...f.names], f.assets);
        assert.equal(context.length, count);
        const bound = bindCgCaption(f.caption, f.characterMeta, context, f.assets);
        assert.equal(bound.ok, true);
        for (const binding of bound.characterMeta.characters) {
            assert.equal(binding.identityAnchor, `${binding.characterKey} identity.`);
            assert.match(bound.caption.v4_prompt.caption.char_captions[binding.captionIndex].char_caption, new RegExp(binding.characterKey + ' identity'));
        }
        assert.equal(JSON.stringify(bound.caption).includes('characterKey'), false);
        assert.equal(f.caption.v4_prompt.caption.char_captions[0].char_caption, 'Alice smiles.');
        const bad = structuredClone(f.characterMeta);
        bad.characters[0].characterKey = 'Unknown';
        assert.equal(bindCgCaption(f.caption, bad, context, f.assets).ok, false);
        bad.characters[0] = { ...bad.characters[1] };
        assert.equal(bindCgCaption(f.caption, bad, context, f.assets).ok, false);
        assert.equal(bindCgCaption(f.caption, undefined, context, f.assets).characterMeta, undefined);
    }
});

test('gate:cg-reference:canvas-budget-unmasked-inset-and-outside-rgba', async () => {
    const { planReferenceCanvas, buildReferencePixels, composeReferencePixels } = await import('../src/media/cg-reference-canvas.js');
    const image = (width, height, rgba) => ({ width, height, data: new Uint8ClampedArray(Array.from({ length: width * height }, () => rgba).flat()) });
    for (const [width, height] of [[128, 64], [64, 128], [1216, 832]]) {
        const meta = { characters: ['A', 'B'].map((characterKey, i) => ({ characterKey, positionExplicit: true, centers: [{ x: i ? 0.75 : 0.25, y: 0.5 }] })) };
        const plan = planReferenceCanvas(width, height, meta, 'A');
        assert.equal(plan.ok, true);
        assert.equal(plan.size.width % 64 + plan.size.height % 64, 0);
        assert.ok(plan.size.width * plan.size.height <= 1024 * 1024);
        const source = image(width, height, [12, 24, 36, 127]);
        const ref = image(16, 32, [200, 100, 0, 128]);
        const work = buildReferencePixels(source, ref, plan);
        assert.equal(plan.reference.x, Math.floor(plan.size.width * 0.75));
        assert.equal(plan.reference.y, 0);
        assert.equal(plan.reference.x + plan.reference.width, plan.size.width);
        assert.equal(plan.reference.height, plan.size.height);
        let white = 0, soft = 0;
        for (let y = 0; y < plan.size.height; y++) for (let x = 0; x < plan.size.width; x++) {
            const at = (y * plan.size.width + x) * 4;
            const v = work.mask.data[at];
            white += v === 255;
            soft += v > 0 && v < 255;
            assert.deepEqual([...work.mask.data.subarray(at, at + 4)], [v, v, v, 255]);
            assert.ok(v === 0 || v === 255, '输入蒙版只含黑白值，不含羽化或抗锯齿灰度');
            if (x >= plan.reference.x) assert.equal(v, 0, '参考区不遮罩');
            else {
                assert.deepEqual(work.image.data.subarray(at, at + 4), source.data.subarray(0, 4), '工作区留白延续 CG 像素');
                const sx = Math.floor(plan.crop.x + (x + 0.5) * plan.crop.width / plan.work.width);
                const sy = Math.floor(plan.crop.y + (y + 0.5) * plan.crop.height / plan.work.height);
                if (x < plan.work.width && y < plan.work.height) {
                    const inside = sx >= plan.rect.x && sx < plan.rect.right && sy >= plan.rect.y && sy < plan.rect.bottom;
                    assert.equal(v, inside ? 255 : 0, '原角色矩形含角点为白色，裁剪上下文为黑色');
                }
                if (x >= plan.work.width || y >= plan.work.height) assert.equal(v, 0, '取整延展不开放重绘');
            }
        }
        assert.ok(white > 0);
        assert.equal(soft, 0, '输入蒙版没有灰度过渡');
        const generated = image(plan.size.width, plan.size.height, [255, 0, 0, 255]);
        for (let y = 0; y < generated.height; y++) for (let x = plan.reference.x; x < generated.width; x++)
            generated.data.set([0, 255, 255, 255], (y * generated.width + x) * 4);
        const candidate = composeReferencePixels(source, generated, plan);
        assert.deepEqual([candidate.width, candidate.height], [width, height]);
        let changed = 0;
        for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
            const i = (y * width + x) * 4;
            const bounds = plan.rect;
            const outside = x < bounds.x || x >= bounds.right || y < bounds.y || y >= bounds.bottom;
            if (outside) assert.deepEqual(candidate.data.subarray(i, i + 4), source.data.subarray(i, i + 4));
            else changed += candidate.data[i] !== source.data[i];
            assert.ok(candidate.data[i + 1] <= 24, '辅助参考区颜色不进入 CG');
            assert.equal(candidate.data[i + 3], source.data[i + 3]);
        }
        const { rect } = plan;
        for (const [x, y] of [[rect.x, rect.y], [rect.right - 1, rect.y],
            [rect.x, rect.bottom - 1], [rect.right - 1, rect.bottom - 1]]) {
            const i = (y * width + x) * 4;
            assert.deepEqual(candidate.data.subarray(i, i + 4), source.data.subarray(i, i + 4), '圆角不覆盖原矩形角点');
        }
        const edgeArtifact = image(plan.size.width, plan.size.height, [12, 24, 36, 255]);
        for (let at = 0; at < work.mask.data.length; at += 4) {
            if (work.mask.data[at] === 0) edgeArtifact.data.set([255, 220, 160, 255], at);
        }
        const guarded = composeReferencePixels(source, edgeArtifact, plan);
        assert.ok(edgeArtifact.data.some((v, at) => at % 4 === 0 && v === 255),
            '夹具实际包含高对比度边缘伪影');
        assert.deepEqual(guarded.data, source.data,
            '黑色蒙版上下文、取整延展和参考区不贴回 CG');
        const midX = Math.floor((rect.x + rect.right) / 2), midY = Math.floor((rect.y + rect.bottom) / 2);
        const blendFeather = Math.max(1, Math.min(96, Math.min(rect.right - rect.x, rect.bottom - rect.y) * 0.16));
        const edgePaths = [
            (d) => [rect.x + d, midY], (d) => [rect.right - 1 - d, midY],
            (d) => [midX, rect.y + d], (d) => [midX, rect.bottom - 1 - d],
        ];
        for (const pointAt of edgePaths) {
            let previous = 12;
            for (let d = 0; d <= Math.ceil(blendFeather) + 2; d++) {
                const [x, y] = pointAt(d), at = (y * width + x) * 4;
                const red = candidate.data[at];
                assert.ok(red >= previous, '四边从原图向重绘图单调渐变');
                assert.ok(red <= 255);
                assert.equal(candidate.data[at + 3], 127, '混合不改变原透明度');
                previous = red;
            }
            const mixed = Array.from({ length: Math.ceil(blendFeather) + 1 }, (_, d) => {
                const [x, y] = pointAt(d);
                return (y * width + x) * 4;
            }).find((at) => candidate.data[at] > 12 && candidate.data[at] < 255
                && candidate.data[at + 1] > 0 && candidate.data[at + 1] < 24);
            assert.notEqual(mixed, undefined, '实际缩放采样后混合带同时含原图和重绘图');
            assert.ok(candidate.data[mixed + 1] > 0 && candidate.data[mixed + 1] < 24);
            if (blendFeather > 48) {
                const [bx, by] = pointAt(32), beyondOldEdge = (by * width + bx) * 4;
                assert.ok(candidate.data[beyondOldEdge] < 255, '大图超过旧 24px 混合带仍保留原图成分');
            }
        }
        const centerAt = (midY * width + midX) * 4;
        assert.deepEqual([...candidate.data.subarray(centerAt, centerAt + 4)], [255, 0, 0, 127], '中心不整图降透明度');
        assert.deepEqual([...source.data.subarray(centerAt, centerAt + 4)], [12, 24, 36, 127], '合成不修改输入原图');
        assert.ok(changed > 0);
        assert.equal(planReferenceCanvas(width, height, { characters: [{ characterKey: 'A', centers: [{ x: 0.5, y: 0.5 }] }] }, 'A').ok, false);
    }
    const width = 256, height = 256;
    const source = image(width, height, [12, 24, 36, 127]), ref = image(16, 32, [0, 255, 255, 255]);
    const cases = [
        { region: { x: 0.25, y: 0.25, width: 0.5, height: 0.5 }, bounds: { x: 64, y: 64, right: 192, bottom: 192 } },
        { region: { x: 0.05, y: 0.25, width: 0.5, height: 0.5 }, bounds: { x: 12, y: 64, right: 141, bottom: 192 } },
        { region: { x: 0.45, y: 0.25, width: 0.5, height: 0.5 }, bounds: { x: 115, y: 64, right: 244, bottom: 192 } },
        { region: { x: 0.25, y: 0.05, width: 0.5, height: 0.5 }, bounds: { x: 64, y: 12, right: 192, bottom: 141 } },
        { region: { x: 0.25, y: 0.45, width: 0.5, height: 0.5 }, bounds: { x: 64, y: 115, right: 192, bottom: 244 } },
        { region: { x: 0, y: 0, width: 1, height: 1 }, bounds: { x: 0, y: 0, right: 256, bottom: 256 } },
    ];
    for (const { region, bounds } of cases) {
        const plan = planReferenceCanvas(width, height, { characters: [{ characterKey: 'A', region }] }, 'A');
        assert.equal(plan.ok, true);
        assert.deepEqual(plan.rect, bounds, '重绘和回贴均使用原角色粗区域');
        const margin = Math.ceil(Math.min(width, height) * 0.1);
        assert.deepEqual(plan.crop, { x: Math.max(0, bounds.x - margin), y: Math.max(0, bounds.y - margin),
            right: Math.min(width, bounds.right + margin), bottom: Math.min(height, bounds.bottom + margin),
            width: Math.min(width, bounds.right + margin) - Math.max(0, bounds.x - margin),
            height: Math.min(height, bounds.bottom + margin) - Math.max(0, bounds.y - margin) });
        const work = buildReferencePixels(source, ref, plan);
        const generated = image(plan.size.width, plan.size.height, [255, 0, 0, 255]);
        const edgeArtifact = image(plan.size.width, plan.size.height, [12, 24, 36, 255]);
        for (let at = 0; at < work.mask.data.length; at += 4) {
            if (work.mask.data[at] === 0) edgeArtifact.data.set([255, 220, 160, 255], at);
        }
        assert.deepEqual(composeReferencePixels(source, edgeArtifact, plan).data, source.data,
            '内部与触边规划均隔离黑色蒙版及参考区伪影');
        const candidate = composeReferencePixels(source, generated, plan);
        for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
            const at = (y * width + x) * 4;
            if (x < bounds.x || x >= bounds.right || y < bounds.y || y >= bounds.bottom)
                assert.deepEqual(candidate.data.subarray(at, at + 4), source.data.subarray(at, at + 4));
            assert.equal(candidate.data[at + 3], 127);
        }
        const midX = Math.floor((bounds.x + bounds.right) / 2), midY = Math.floor((bounds.y + bounds.bottom) / 2);
        for (const [x, y] of [[bounds.x, midY], [bounds.right - 1, midY],
            [midX, bounds.y], [midX, bounds.bottom - 1]]) {
            const at = (y * width + x) * 4;
            assert.deepEqual(candidate.data.subarray(at, at + 4), source.data.subarray(at, at + 4),
                '四侧统一保留边缘原像素，包括真正触及整图边缘的区域');
        }
    }
});


async function consistencyFixture(count = 2, storeOverride) {
    const { createAutoIllustrationService } = await import('../src/generated-images/illustration/auto-illustration-service.js');
    const { createMemoryIllustrationStore } = await import('../src/media/illustration-store.js');
    const store = storeOverride || createMemoryIllustrationStore();
    const floor = { chatId: 'fixture-cg', messageId: 5, swipeId: 0, isAi: true, text: '测试正文。\n[igs-img:7]' };
    const key = 'fixture-cg|5|0';
    const image = (width, height, color) => {
        const data = new Uint8ClampedArray(width * height * 4);
        for (let i = 0; i < data.length; i += 4) data.set(color, i);
        return { width, height, data };
    };
    const pixels = new Map([['original', image(128, 64, [12, 24, 36, 255])]]);
    let encoded = 0;
    const codec = { available: true,
        async decodeImage(src) { assert.ok(pixels.has(src), src); return pixels.get(src); },
        async encodePixels(value) { const id = `pixels-${++encoded}`; pixels.set(id, value); return id; },
    };
    const names = ['A', 'B', 'C'].slice(0, count);
    const characters = names.map((characterKey, captionIndex) => ({ characterKey, captionIndex,
        identityAnchor: `old-${characterKey}`, signatureDetails: '', outfit: { name: '冬装', description: `coat-${characterKey}` },
        centers: [{ x: (captionIndex + 0.5) / count, y: 0.5 }], positionExplicit: true,
    }));
    const assets = { characters: {}, characterDna: {} };
    for (const [i, name] of names.entries()) {
        assets.characters[name] = { 默认: `reference-${name}` };
        assets.characterDna[name] = { version: 2, identityInitialized: true, views: Object.fromEntries(
            ['full_body', 'half_body', 'portrait', 'partial'].map((frame) =>
                [frame, { subject: `new-${name}`, negative: `wrong-${name}` }])) };
        pixels.set(`reference-${name}`, image(16, 32, [80 + i * 60, 100, 0, 255]));
    }
    const caption = {
        v4_prompt: { caption: { base_caption: 'Two people interacting in a room.', char_captions: characters.map((c) => ({ char_caption: `${c.characterKey}, ${c.identityAnchor}, ${c.outfit.description}`, centers: c.centers })) } },
        v4_negative_prompt: { caption: { base_caption: '', char_captions: characters.map(() => ({ char_caption: '' })) } },
    };
    const template = structuredClone(caption);
    template.v4_prompt.caption.char_captions.forEach((c, i) => { c.char_caption = `<<dna:actor${i}>> wears coat-${names[i]}.`; });
    const promptRecipe = { version: 1, mode: 'dna_template', caption: template,
        bindings: characters.map((c, i) => ({ kind: 'named', characterKey: c.characterKey,
            captionIndex: i, token: `actor${i}`, framing: 'half_body' })) };
    const before = await store.putSlot(key, { slot: 7, status: 'done', dataUrl: 'original', caption, promptRecipe,
        characterMeta: { version: 1, characters: characters.slice().reverse() }, originalSize: { width: 128, height: 64 } });
    const calls = [], references = [], events = [], writes = [];
    const { createImageJobLog } = await import('../src/generated-images/image-job-log.js');
    const logData = new Map(), reports = [];
    const logStorage = { getItem: (key) => logData.get(key), setItem: (key, value) => logData.set(key, value) };
    const jobLog = createImageJobLog({ storage: logStorage });
    const backend = { describeEdit: () => ({ supported: true, via: 'dbgen' }),
        async getEditConfig() { return { ok: true, version: 1, configToken: 'fixture-config', artist: null, isCurrent: () => true }; },
        async writeDbgenPrompt(request) {
            writes.push(request);
            const captions = request.promptTask.slots.map(({ slotId, tokens }) => {
                const rows = tokens.map((token) => request.promptTask.characters.find((c) => c.token === token));
                const ref = rows.find((c) => c.kind === 'reference');
                const caption = {
                    v4_prompt: { caption: { base_caption: ref
                        ? 'Two people interacting in a room, preserving their original clothing and interaction.'
                        : 'Two people interacting in a room.', char_captions: rows.map((c) => ({
                        char_caption: `<<dna:${c.token}>> ${c.kind === 'reference' ? 'is visible from the shoulders up.' : `wears coat-${c.characterKey}.`}`,
                        centers: [{ x: 0.5, y: 0.5 }] })) } },
                    v4_negative_prompt: { caption: { base_caption: ref ? 'decorative frame, golden border, split screen, collage, duplicate person' : '', char_captions: rows.map((c) => ({ char_caption: `<<dna_uc:${c.token}>>` })) } },
                };
                return { slotId, caption, promptRecipe: { version: 1, mode: 'dna_template', caption,
                    bindings: rows.map((c, captionIndex) => ({ ...c, captionIndex })) },
                    characterMeta: { version: 1, characters: rows.flatMap((c, captionIndex) => c.kind === 'reference' ? [] : [{
                        ...structuredClone(characters.find((m) => m.characterKey === c.characterKey)), captionIndex,
                        centers: [{ x: 0.5, y: 0.5 }], positionExplicit: true }]) } };
            }).reverse();
            return { ok: true, captions };
        },
        async edit(request) {
            calls.push(request);
            const { prepareCharacterCaption } = await import('../src/generated-images/character-caption.js');
            const { promptSnapshotFromBody } = await import('../src/generated-images/final-caption.js');
            const prepared = prepareCharacterCaption(request);
            assert.equal(prepared.ok, true, prepared.error);
            const src = await codec.encodePixels(image(request.width, request.height, [220, calls.length * 50, 20, 255]));
            return { ...prepared, dataUrl: src, sentPrompt: promptSnapshotFromBody({ model: 'nai-diffusion-5-full',
                action: 'infill', parameters: prepared.caption }, null) };
        },
    };
    const igsSettings = {};
    const service = createAutoIllustrationService({ store, nai: backend, imageCodec: codec,
        getSettings: () => igsSettings, getSceneAssets: () => assets,
        report: (level, message) => { reports.push({ level, message }); jobLog.add(level, message); },
        resolveCgReference: async (name, snapshot) => { references.push(name); return snapshot.characters[name]?.默认 || ''; },
        messageHost: { readFloor: () => floor, getChatId: () => floor.chatId, destroy() {} },
        events: { emit: (name, detail) => events.push({ name, detail }) },
    });
    return { store, floor, key, pixels, codec, names, assets, before, calls, writes, references, events, backend, service, reports, jobLog, logStorage, igsSettings,
        query: { chatId: floor.chatId, messageId: 5, swipeId: 0, slot: 7 } };
}

for (const count of [2, 3]) test(`gate:cg-consistency:${count}-characters-candidate-accept-roundtrip`, async () => {
    const f = await consistencyFixture(count);
    const candidate = await f.service.redrawConsistency(f.query);
    assert.equal(candidate.ok, true, JSON.stringify(candidate));
    assert.equal(candidate.reason, 'candidate');
    assert.equal(f.calls.length, count);
    assert.equal(f.writes.length, count + 1, '正式场景与各工作轮次独立并发写词');
    assert.equal(f.writes[0].promptTask.purpose, 'consistency');
    assert.match(f.writes[0].description, /保姿优先于身份相似度/);
    assert.match(f.writes[0].description, /不得据此重塑原 CG 的身体轮廓、骨架、肢体长度或躯干比例/);
    assert.match(f.writes[0].description, /每个工作轮次独立用于实际重绘，不会继承 slotid 1 的正文/);
    assert.match(f.writes[0].description, /必须在每份工作 Scene 与对应目标 Char 中具体保留/);
    assert.doesNotMatch(f.writes[0].description, /肤色、体型比例和/);
    assert.ok(f.writes[0].description.includes(JSON.stringify(f.before.promptRecipe.caption)), '原场景与各 Char 的动态依据完整交给同次写词');
    assert.deepEqual(f.references, f.names);
    assert.deepEqual(await f.store.getSlotRecord(f.before.key), f.before, '候选前不写正式记录');
    assert.deepEqual([candidate.width, candidate.height], [128, 64]);
    for (const [i, request] of f.calls.entries()) {
        assert.equal(await request.shouldStart(), true);
        assert.equal(request.strength, 0.75, '一致性每轮显式使用专用重绘强度');
        assert.match(request.caption.v4_prompt.caption.base_caption, /preserving their original clothing and interaction/);
        assert.doesNotMatch(request.caption.v4_prompt.caption.base_caption, /reference inset|frame|border|split screen|collage/i);
        assert.match(request.caption.v4_negative_prompt.caption.base_caption, /decorative frame, golden border, split screen, collage, duplicate person/);
        const chars = request.caption.v4_prompt.caption.char_captions;
        assert.ok(chars.every((c) => c.centers.every((p) => p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1)));
        assert.ok(chars.some((c) => c.char_caption.includes(`<<dna:ref${i}>>`)));
        assert.ok(chars.every((c) => !c.char_caption.includes('new-')), '服务不能提前展开身份');
        const { prepareCharacterCaption } = await import('../src/generated-images/character-caption.js');
        const prepared = prepareCharacterCaption(request);
        assert.equal(prepared.ok, true, prepared.error);
        assert.ok(prepared.caption.v4_prompt.caption.char_captions.some((c) => c.char_caption.includes(`new-${f.names[i]}`)));
        assert.ok(chars.every((c) => !c.char_caption.includes('old-')));
        const source = f.pixels.get(request.sourceDataUrl), mask = f.pixels.get(request.maskDataUrl);
        assert.deepEqual([mask.width, mask.height], [source.width, source.height]);
        assert.ok(source.width * source.height <= 1024 * 1024);
        assert.equal(source.width % 64 + source.height % 64, 0);
    }
    const { planReferenceCanvas } = await import('../src/media/cg-reference-canvas.js');
    const rects = f.before.characterMeta.characters.map((c) => planReferenceCanvas(128, 64, f.before.characterMeta, c.characterKey).rect);
    const result = f.pixels.get(candidate.dataUrl), original = f.pixels.get('original');
    for (let y = 0; y < 64; y++) for (let x = 0; x < 128; x++) {
        if (rects.some((r) => x >= r.x && x < r.right && y >= r.y && y < r.bottom)) continue;
        const i = (y * 128 + x) * 4;
        assert.deepEqual(result.data.subarray(i, i + 4), original.data.subarray(i, i + 4));
    }
    assert.equal(f.events.some((e) => e.name === 'igs:illustration-updated'), false);
    assert.equal((await f.service.redrawConsistency(f.query)).reason, 'consistency-busy');
    assert.equal((await f.service.acceptConsistency(candidate.candidateId)).ok, true);
    const saved = await f.store.getSlotRecord(f.before.key);
    assert.equal(saved.dataUrl, candidate.dataUrl);
    assert.equal(saved.consistencyBaselineDataUrl, 'original');
    assert.equal(saved.revision, f.before.revision + 1);
    assert.deepEqual(saved.characterMeta.characters.map((c) => c.characterKey), f.names);
    assert.equal(saved.sentPrompt, undefined, '合成后的正式 CG 没有伪造整图 wire');
    assert.equal(saved.consistencyPrompt.rounds.length, count);
    assert.deepEqual(saved.consistencyPrompt.rounds.map((r) => r.characterKey), f.names);
    assert.ok(saved.consistencyPrompt.rounds.every((r) => r.sentPrompt.action === 'infill'));
    assert.ok(saved.promptRecipe.bindings.every((b) => b.kind === 'named'));
    assert.equal(saved.caption.v4_prompt.caption.base_caption.includes('reference inset'), false);
    assert.equal(f.service.getIllustrationUrl(f.query), candidate.dataUrl);
    assert.equal(f.events.filter((e) => e.name === 'igs:illustration-updated').length, 1);
    assert.equal((await f.service.acceptConsistency(candidate.candidateId)).reason, 'candidate-unavailable');
});


test('gate:cg-consistency:missing-reference-fails-before-any-request', async () => {
    const f = await consistencyFixture();
    delete f.assets.characters.B.默认;
    assert.equal((await f.service.redrawConsistency(f.query)).reason, 'cg-reference-missing');
    assert.equal(f.calls.length, 0);
    assert.deepEqual(await f.store.getSlotRecord(f.before.key), f.before);
});

test('gate:cg-consistency:failure-and-cancel-discard-all-partial-results', async () => {
    for (const mode of ['failure', 'cancel']) {
        const f = await consistencyFixture();
        const edit = f.backend.edit;
        f.backend.edit = async (request) => {
            if (f.calls.length === 1) {
                if (mode === 'cancel') f.service.cancelConsistency();
                return { ok: false, reason: 'edit-failed' };
            }
            return edit(request);
        };
        const result = await f.service.redrawConsistency(f.query);
        assert.equal(result.ok, false);
        assert.equal(result.reason, mode === 'cancel' ? 'cancelled' : 'edit-failed');
        assert.deepEqual(await f.store.getSlotRecord(f.before.key), f.before);
        assert.equal(f.events.some((e) => e.name === 'igs:illustration-updated'), false);
        assert.equal((await f.service.acceptConsistency(result.candidateId)).reason, 'candidate-unavailable');
    }
});

test('gate:cg-consistency:late-concurrent-results-cannot-save-or-restart', async () => {
    const f = await consistencyFixture();
    const finishes = []; let started;
    const ready = new Promise((resolve) => { started = resolve; });
    f.backend.edit = (request) => { f.calls.push(request); if (f.calls.length === 2) started(); return new Promise((resolve) => { finishes.push(resolve); }); };
    const controller = new AbortController();
    const pending = f.service.redrawConsistency(f.query, { signal: controller.signal });
    await ready;
    controller.abort();
    assert.equal((await pending).reason, 'cancelled');
    assert.ok(f.calls.every((request) => request.shouldStart() === false));
    finishes.forEach((finish) => finish({ ok: true, dataUrl: 'original' }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(f.calls.length, 2);
    assert.deepEqual(await f.store.getSlotRecord(f.before.key), f.before);
});

test('gate:cg-consistency:candidate-cancel-target-change-revision-and-storage-error', async () => {
    for (const mode of ['cancel', 'swipe', 'chat', 'marker', 'revision', 'recreate', 'storage']) {
        const f = await consistencyFixture();
        const candidate = await f.service.redrawConsistency(f.query);
        assert.equal(candidate.ok, true);
        let expected = f.before;
        if (mode === 'cancel') f.service.cancelConsistency(candidate.candidateId);
        if (mode === 'swipe') f.floor.swipeId = 1;
        if (mode === 'chat') f.floor.chatId = 'other-chat';
        if (mode === 'marker') f.floor.text = '挂载点已清扫';
        if (mode === 'revision' || mode === 'recreate') {
            if (mode === 'recreate') await f.store.deleteSlot(f.key, 7);
            expected = await f.store.putSlot(f.key, { ...f.before, dataUrl: 'newer-image' });
        }
        if (mode === 'storage') f.store.updateSlot = async () => { throw new Error('fixture-storage-error'); };
        const result = await f.service.acceptConsistency(candidate.candidateId);
        assert.equal(result.ok, false, mode);
        assert.equal(result.reason, mode === 'cancel' ? 'candidate-unavailable'
            : mode === 'storage' ? 'slot-update-failed'
                : ['revision', 'recreate'].includes(mode) ? 'stale-revision' : 'stale-target');
        assert.deepEqual(await f.store.getSlotRecord(f.before.key), expected, mode);
        assert.equal(f.events.some((e) => e.name === 'igs:illustration-updated'), false);
    }
});


function codecFixture(mode = 'ok') {
    const images = [], timers = new Map();
    let serial = 0, canvases = 0, written;
    const context = {
        drawImage() {},
        getImageData: () => ({ data: new Uint8ClampedArray(64 * 64 * 4).fill(127) }),
        createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
        putImageData: (pixels) => { written = pixels.data; },
    };
    const globalObject = {
        Image: class {
            constructor() { images.push(this); this.naturalWidth = mode === 'large' ? 2048 : 64; this.naturalHeight = mode === 'large' ? 1024 : 64; }
            set src(value) { this.value = value; if (!value || mode === 'stall') return;
                queueMicrotask(() => mode === 'error' ? this.onerror?.() : this.onload?.()); }
        },
        setTimeout(fn) { timers.set(++serial, fn); return serial; },
        clearTimeout(id) { timers.delete(id); },
        document: { createElement() { canvases++; return { getContext: () => mode === 'context' ? null : context,
            toDataURL: () => 'data:image/png;base64,ENCODED' }; } },
    };
    return { globalObject, images, timers, get canvases() { return canvases; }, get written() { return written; } };
}

test('gate:cg-codec:decode-encode-budget-errors-and-cancel-release-handlers', async () => {
    const { createCanvasImageCodec } = await import('../src/media/canvas-image-codec.js');
    const f = codecFixture(), codec = createCanvasImageCodec(f.globalObject);
    const pixels = await codec.decodeImage('fixture');
    assert.deepEqual([pixels.width, pixels.height], [64, 64]);
    assert.equal(f.timers.size, 0);
    assert.equal(f.images[0].onload, null);
    assert.equal(await codec.encodePixels(pixels), 'data:image/png;base64,ENCODED');
    assert.deepEqual(f.written, pixels.data);
    for (const [mode, reason] of [['error', 'image-load-failed'], ['context', 'no-canvas-context'], ['large', 'image-size-invalid']]) {
        const fixture = codecFixture(mode);
        await assert.rejects(createCanvasImageCodec(fixture.globalObject).decodeImage('fixture'), new RegExp(reason));
        if (mode === 'large') assert.equal(fixture.canvases, 0);
        assert.equal(fixture.timers.size, 0);
    }
    for (const timeout of [false, true]) {
        const fixture = codecFixture('stall'), controller = new AbortController();
        const pending = createCanvasImageCodec(fixture.globalObject).decodeImage('fixture', { signal: controller.signal });
        if (timeout) [...fixture.timers.values()][0](); else controller.abort();
        await assert.rejects(pending, new RegExp(timeout ? 'image-load-timeout' : 'image-load-cancelled'));
        assert.equal(fixture.timers.size, 0);
        assert.equal(fixture.images[0].value, '');
        assert.equal(fixture.images[0].onerror, null);
    }
});

// 普通 CG 集成夹具：实际 planner parser、发送 Adapter 与存储事务；外部服务全部隔离。
function cgTemplateText(slotId, at, rows = []) {
    return [`slotid: ${slotId}`, ...(at !== undefined ? [`at: ${at}`] : []),
        'prompt_mode: dna_template', 'scene: Friends meet in a cafe. High quality illustration.',
        'scene_uc: blurry', ...rows.flatMap(({ key, token, frame = 'half_body', x = 0.3, identity }, index) => [
            `char: ${x},0.5 | <<dna:${token}>> wears a blue coat and waves toward Alice.`,
            `char_uc: <<dna_uc:${token}>>, closed eyes`, `meta_kind: ${index} | named`,
            `meta_key: ${index} | ${key}`, `meta_token: ${index} | ${token}`,
            `meta_frame: ${index} | ${frame}`, `meta_outfit_name: ${index} | Coat`,
            `meta_outfit_description: ${index} | A blue coat.`,
            ...(identity !== undefined ? [`meta_identity: ${index} | ${identity}`,
                `meta_signature: ${index} | silver hair clip`] : []),
        ])].join('\n');
}

async function cgTemplateRun(mode, reply, assets, count = 2, options = {}) {
    const { createAutoIllustrationService } = await import('../src/generated-images/illustration/auto-illustration-service.js');
    const { createImageBackend } = await import('../src/generated-images/image-backend.js');
    const { createNaiOfficialClient } = await import('../src/generated-images/nai-official-client.js');
    const { createIndexedDbIllustrationStore } = await import('../src/media/illustration-store.js');
    const { createTransactionalIdb } = await import('./helpers/transactional-idb.js');
    const wires = [], writes = [], llmRequests = [];
    const fake = makeFakes({ text: NSFW_TEXT + '\n' + Object.keys(assets.characters).map((name) =>
        `[igs-char:${name}|smile|Hello]`).join('\n'), settings: { nsfwEnabled: true, nsfwCount: count } });
    const bridge = { imageApi: { mode }, autoIllustration: { nsfwEnabled: true, nsfwCount: count,
        nai: { apiKey: 'fake-key', model: 'nai-diffusion-5-full', artistPrefix: 'artist:test', negativePrompt: 'custom-uc' } } };
    const llm = { request: async (request) => { llmRequests.push(request); return reply; } };
    const nai = createNaiOfficialClient({ fetch: async (_url, init) => {
        wires.push(JSON.parse(init.body));
        return new Response(JSON.stringify({ images: [{ image: 'data:image/png;base64,AAAA' }] }),
            { status: 200, headers: { 'Content-Type': 'application/json' } });
    } });
    let pipeline;
    let dbgenImageService;
    if (mode === 'dbgen') {
        const { createImageGenService } = await import('../../../nai-dbgen/src/application/image-gen.service.js');
        const { createNaiGateway } = await import('../../../nai-dbgen/src/adapters/nai/nai.gateway.js');
        const { createDirectTransport } = await import('../../../nai-dbgen/src/adapters/nai/transport/direct.js');
        const { defaultPluginSettings } = await import('../../../nai-dbgen/src/domain/model/plugin-settings.js');
        const { Ok } = await import('../../../nai-dbgen/src/infra/result.js');
        const settings = { ...defaultPluginSettings(), activeNaiConfigId: 'fake', activeArtistId: 'artist' };
        settings.naiParams = { ...settings.naiParams, model: 'nai-diffusion-5-full' };
        const gateway = createNaiGateway({ transports: { direct: createDirectTransport({ fetch: async (_url, init) => {
            wires.push(JSON.parse(init.body));
            return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
        } }) }, decoders: { 'json-base64': { decode: async () => Ok([
            { blob: new Blob(['fake'], { type: 'image/png' }), mimeType: 'image/png' },
        ]) } } });
        dbgenImageService = createImageGenService({ imageGenPort: gateway, loadSettings: () => settings,
            naiConfigRepo: { get: async () => Ok({ id: 'fake', baseUrl: 'https://example.invalid',
                apiKey: 'fake-key', transport: 'direct', decoder: 'json' }) },
            artistRepo: { get: async () => Ok({ positivePrompt: 'artist:test', negativePrompt: '' }) },
            newTraceId: () => 'cg-offline-wire' });
    }
    const api = { getPromptCapabilities: () => ({ finalCaption: 1, promptSnapshot: 1 }),
        async generateSinglePrompt(request) {
            writes.push(request);
            const { buildPipeline } = await import('../../../nai-dbgen/tests/application/_fakes.js');
            const { Ok } = await import('../../../nai-dbgen/src/infra/result.js');
            pipeline = buildPipeline({ llmComplete: async () => Ok({ text: reply, json: null }) });
            pipeline.host.byId.set(5, { messageId: 5, name: 'Bot', text: fake.messageHost.readFloor(5).text,
                isUser: false, isSystem: false });
            // 召回是隔离端口替身；编号到原句的映射仍经真实 workbench。
            pipeline.tagRecall.recall = async () => Ok({ positions: [
                { slotId: 6, anchorSentence: '二段。', keys: [] },
                { slotId: 7, anchorSentence: '三段。', keys: [] },
            ], unmatchedKeys: [] });
            return pipeline.workbench.writePrompt({ mode: 'floor', messageId: 5,
                naturalLanguage: request.description, characterContext: request.characterContext,
                promptTask: request.promptTask, writingRequirements: request.writingRequirements });
        },
        async generate(request) {
            return dbgenImageService.generate(request);
        },
    };
    const backend = options.backend || createImageBackend({ global: mode === 'dbgen' ? { NaiDbGen: api } : {},
        getBridge: () => bridge, nai, llm });
    const idb = createTransactionalIdb();
    const store = options.store || createIndexedDbIllustrationStore({ indexedDB: idb });
    const service = createAutoIllustrationService({ ...fake, nai: backend, llm, store,
        getSettings: () => bridge.autoIllustration, getSceneAssets: () => assets });
    const result = await service.processMessage(5);
    return { result, service, store, fake, wires, writes, llmRequests, bridge,
        dispose: () => dbgenImageService?.dispose(), get pipeline() { return pipeline; } };
}

function cgTemplateAssets() {
    const names = ['Alice', 'Bob', 'Carol'];
    return { characters: Object.fromEntries(names.map((key) => [key, {}])),
        characterAliases: { Alice: ['A'] }, characterDna: Object.fromEntries(names.map((key) => [key,
            { version: 2, defaultAppearance: 'DO-NOT-APPEND-OUTFIT', views: Object.fromEntries(
                ['full_body', 'half_body', 'portrait', 'partial'].map((frame) => [frame,
                    { subject: `${key}, ${frame} saved identity,`, negative: `${key} wrong identity` }])) }])) };
}

for (const mode of ['nai', 'dbgen']) {
    test(`gate:scene-only:${mode}:纯场景贯通写词预检发送与重画`, async () => {
        for (const marked of [false, true]) {
            if (mode === 'nai' && !marked) continue;
            const slot = mode === 'nai' ? 1 : 6;
            const reply = [`slotid: ${slot}`, ...(mode === 'nai' ? ['at: 2'] : []),
                ...(marked ? ['prompt_mode: dna_template'] : []),
                'scene: An empty moonlit courtyard.', 'scene_uc: blurry'].join('\n');
            const assets = { characters: {}, characterAliases: {}, characterDna: {} };
            const run = await cgTemplateRun(mode, reply, assets, 1);
            try {
                assert.equal(run.result.ok, true, run.result.error);
                assert.equal(run.result.count, 1);
                assert.equal(run.wires.length, 1);
                assert.deepEqual(run.wires[0].parameters.v4_prompt.caption.char_captions, []);
                assert.equal(run.wires[0].input, mode === 'dbgen' && !marked
                    ? 'artist:test, An empty moonlit courtyard., very aesthetic, masterpiece, no text'
                    : 'artist:test, An empty moonlit courtyard.');
                if (mode === 'dbgen') {
                    assert.equal(Object.hasOwn(run.writes[0], 'promptTask'), false);
                    assert.equal(Object.hasOwn(run.writes[0], 'characterContext'), false);
                    assert.match(run.writes[0].description, /纯场景不需要 DNA/);
                }
                assert.equal((await run.store.getSlotRecord(`c1|5|0|${slot}`)).status, 'done');
                const rerolled = await run.service.rerollSlot({ chatId: 'c1', messageId: 5, swipeId: 0, slot });
                assert.equal(rerolled.ok, true, rerolled.error);
                assert.equal(run.wires.length, 2);
                assert.equal(run.llmRequests.length + run.writes.length, 1);
                assert.deepEqual(assets, { characters: {}, characterAliases: {}, characterDna: {} });
            } finally { run.dispose(); }
        }
    });
}


for (const mode of ['nai', 'dbgen']) {
    test(`gate:cg-template:${mode}:缺景别使用当次身份且保存真实请求`, async () => {
        const assets = cgTemplateAssets();
        delete assets.characterDna.Bob.views.half_body;
        const before = structuredClone(assets);
        const goodId = mode === 'nai' ? 1 : 6, badId = mode === 'nai' ? 2 : 7;
        const reply = [cgTemplateText(badId, mode === 'nai' ? 3 : undefined,
            [{ key: 'Bob', token: 'r1', identity: 'Bob, an adult man with black hair and a silver hair clip,' }]),
            cgTemplateText(goodId, mode === 'nai' ? 2 : undefined,
            [{ key: 'Alice', token: 'r0', frame: 'portrait', x: 0.7 }])].join('\n---\n');
        const run = await cgTemplateRun(mode, reply, assets);
        try {
            assert.equal(run.result.ok, true, run.result.error);
            assert.equal(run.result.count, 2);
            assert.equal(run.result.failedCount || 0, 0);
            assert.equal(run.wires.length, 2, '当次身份降级不增加写词或补立绘请求');
            assert.equal(run.llmRequests.length, mode === 'nai' ? 1 : 0);
            assert.equal(run.writes.length, mode === 'dbgen' ? 1 : 0);
            if (mode === 'dbgen') {
                assert.equal(run.pipeline.llmCalls.length, 1);
                assert.equal(run.writes[0].skipRecall, undefined);
                assert.equal(run.writes[0].promptTask.purpose, 'cg');
                assert.equal(run.writes[0].promptTask.slots, undefined);
                assert.equal(run.writes[0].writingRequirements.undesiredContent, 'custom-uc');
            } else {
                assert.match(run.llmRequests[0].system, /普通 CG 规划/);
                assert.match(run.llmRequests[0].user, /custom-uc/);
            }
            const records = await run.store.getSlots('c1|5|0');
            const good = records.find((r) => r.slot === goodId), bad = records.find((r) => r.slot === badId);
            const goodWire = run.wires.find((wire) => wire.parameters.v4_prompt.caption.char_captions[0].char_caption.startsWith('Alice,'));
            const badWire = run.wires.find((wire) => wire.parameters.v4_prompt.caption.char_captions[0].char_caption.startsWith('Bob,'));
            assert.ok(goodWire && badWire);
            assert.equal(good.status, 'done');
            assert.equal(bad.status, 'done');
            assert.equal(bad.dnaSnapshot.characters[0].source, 'scene');
            assert.equal(bad.dnaSnapshot.characters[0].dnaVersion, 0);
            assert.equal(bad.dnaSnapshot.characters[0].framing, 'half_body');
            assert.match(bad.sentPrompt.caption.v4_prompt.caption.char_captions[0].char_caption,
                /^Bob, an adult man with black hair and a silver hair clip,/);
            assert.deepEqual(bad.sentPrompt.caption.v4_prompt.caption, badWire.parameters.v4_prompt.caption);
            assert.ok(bad.dataUrl || bad.imageRef);
            assert.equal(good.promptRecipe.bindings[0].characterKey, 'Alice');
            assert.equal(good.dnaSnapshot.characters[0].source, 'saved');
            assert.equal(good.dnaSnapshot.characters[0].framing, 'portrait');
            assert.deepEqual(good.sentPrompt.caption.v4_prompt.caption,
                goodWire.parameters.v4_prompt.caption);
            assert.equal(goodWire.parameters.v4_prompt.caption.char_captions[0].char_caption,
                'Alice, portrait saved identity, wears a blue coat and waves toward Alice.');
            assert.deepEqual(goodWire.parameters.v4_prompt.caption.char_captions[0].centers, [{ x: 0.7, y: 0.5 }]);
            assert.equal(run.wires[0].input, 'artist:test, Friends meet in a cafe. High quality illustration.');
            assert.equal(run.wires[0].parameters.negative_prompt, 'blurry');
            assert.equal(JSON.stringify(run.wires).includes('DO-NOT-APPEND-OUTFIT'), false);
            assert.equal(JSON.stringify(run.wires).includes('<<dna'), false);
            assert.ok(good.promptRecipe.caption.v4_prompt.caption.char_captions[0].char_caption.includes('<<dna:r0>>'));
            assert.equal(good.originalSize.width * good.originalSize.height <= 1024 * 1024, true);
            assert.ok(run.fake.messageHost.readFloor(5).text.includes(`[igs-img:${badId}]`));
            if (mode === 'dbgen') assert.equal(good.anchorSentence, '二段。');
            else assert.equal(good.at, 2);
            assert.deepEqual(assets, before, 'CG 全过程不写回 DNA 或衣装');
        } finally { run.dispose(); }
    });
}

for (const mode of ['nai', 'dbgen']) {
    test(`gate:cg-template:${mode}:普通重画取当前DNA且手改定稿保真`, async () => {
        const assets = cgTemplateAssets(), slot = mode === 'nai' ? 1 : 6;
        const run = await cgTemplateRun(mode, cgTemplateText(slot, mode === 'nai' ? 2 : undefined,
            [{ key: 'Alice', token: 'r0', frame: 'partial' }]), assets, 1);
        try {
            assert.equal(run.result.ok, true, run.result.error);
            const original = await run.store.getSlotRecord(`c1|5|0|${slot}`);
            assets.characterDna.Alice.views.partial.subject = 'Alice current hand with a silver ring,';
            const identity = { chatId: 'c1', messageId: 5, swipeId: 0, slot };
            assert.equal((await run.service.rerollSlot(identity)).ok, true);
            const redrawn = await run.store.getSlotRecord(`c1|5|0|${slot}`);
            assert.equal(redrawn.dnaSnapshot.characters[0].subject, 'Alice current hand with a silver ring,');
            assert.equal(original.dnaSnapshot.characters[0].subject, 'Alice, partial saved identity,');
            assert.deepEqual(redrawn.promptRecipe, original.promptRecipe);
            assert.deepEqual(redrawn.characterMeta.characters[0].outfit, original.characterMeta.characters[0].outfit);
            assert.match(run.wires.at(-1).parameters.v4_prompt.caption.char_captions[0].char_caption, /^Alice current hand/);
            const { editedStoredPrompt, promptFromCaption } = await import('../src/generated-images/generation-prompt.js');
            const caption = structuredClone(redrawn.caption);
            caption.v4_prompt.caption.base_caption = 'Exact manual scene.';
            caption.v4_prompt.caption.char_captions[0].char_caption = 'Exact manual character with red hair.';
            const edited = await run.store.updateSlot('c1|5|0', slot, redrawn.revision,
                { caption, prompt: editedStoredPrompt(promptFromCaption(caption), redrawn), promptEdited: true, captionMode: 'final' },
                { expectedToken: redrawn.revisionToken });
            assert.equal(edited.ok, true);
            delete assets.characterDna.Alice;
            assert.equal((await run.service.rerollSlot(identity)).ok, true);
            const final = await run.store.getSlotRecord(`c1|5|0|${slot}`);
            assert.deepEqual(final.caption, caption);
            assert.deepEqual(final.promptRecipe, original.promptRecipe);
            assert.deepEqual(final.dnaSnapshot, redrawn.dnaSnapshot);
            assert.equal(run.wires.at(-1).input, 'artist:test, Exact manual scene.');
            assert.deepEqual(run.wires.at(-1).parameters.v4_prompt.caption.char_captions, caption.v4_prompt.caption.char_captions);
            assert.equal(run.wires.length, 3);
            assert.equal(run.llmRequests.length + run.writes.length, 1, '重画不增加写词调用');
        } finally { run.dispose(); }
    });
}

for (const mode of ['nai', 'dbgen']) {
    test(`gate:cg-template:${mode}:三人乱序绑定按景别展开不按数组猜身份`, async () => {
        const assets = cgTemplateAssets(), before = structuredClone(assets);
        const rows = [{ key: 'Carol', token: 'r2', frame: 'partial', x: 0.9 },
            { key: 'Alice', token: 'r0', frame: 'full_body', x: 0.1 },
            { key: 'Bob', token: 'r1', frame: 'portrait', x: 0.5 }];
        const run = await cgTemplateRun(mode, cgTemplateText(mode === 'nai' ? 1 : 6,
            mode === 'nai' ? 2 : undefined, rows), assets, 1);
        try {
            assert.equal(run.result.ok, true, run.result.error);
            const record = (await run.store.getSlots('c1|5|0'))[0];
            const chars = run.wires[0].parameters.v4_prompt.caption.char_captions;
            rows.forEach((row, index) => {
                assert.equal(record.promptRecipe.bindings[index].characterKey, row.key);
                assert.equal(record.promptRecipe.bindings[index].captionIndex, index);
                assert.equal(record.dnaSnapshot.characters[index].framing, row.frame);
                assert.equal(chars[index].char_caption,
                    `${row.key}, ${row.frame} saved identity, wears a blue coat and waves toward Alice.`);
                assert.deepEqual(chars[index].centers, [{ x: row.x, y: 0.5 }]);
            });
            assert.deepEqual(assets, before);
            assert.equal(run.llmRequests.length + run.writes.length, 1);
        } finally { run.dispose(); }
    });
    test(`gate:cg-template:${mode}:缺身份失败补齐后只重试失败图`, async () => {
        const assets = cgTemplateAssets(), saved = structuredClone(assets.characterDna.Bob);
        delete assets.characterDna.Bob;
        const goodId = mode === 'nai' ? 1 : 6, badId = mode === 'nai' ? 2 : 7;
        const reply = [cgTemplateText(goodId, mode === 'nai' ? 2 : undefined,
            [{ key: 'Alice', token: 'r0' }]), cgTemplateText(badId, mode === 'nai' ? 3 : undefined,
            [{ key: 'Bob', token: 'r1' }])].join('\n---\n');
        const run = await cgTemplateRun(mode, reply, assets);
        try {
            assert.equal(run.result.failedCount, 1);
            assert.equal((await run.store.getSlotRecord(`c1|5|0|${badId}`)).failureReason, 'DNA_MISSING');
            assets.characterDna.Bob = saved;
            const retry = await run.service.processMessage(5);
            assert.equal(retry.ok, true, retry.error);
            assert.equal(retry.count, 1);
            assert.equal(run.wires.length, 2);
            assert.equal(run.llmRequests.length + run.writes.length, 1);
            const recovered = await run.store.getSlotRecord(`c1|5|0|${badId}`);
            assert.equal(recovered.status, 'done');
            assert.equal(recovered.error, null);
            assert.equal(recovered.failureReason, null);
        } finally { run.dispose(); }
    });
    test(`gate:cg-template:${mode}:无DNA当次身份可回读重画且不建档`, async () => {
        const assets = cgTemplateAssets();
        delete assets.characterDna.Bob;
        const before = structuredClone(assets), slot = mode === 'nai' ? 1 : 6;
        const identity = 'Bob, an adult man with black hair, narrow brown eyes and a silver hair clip,';
        const run = await cgTemplateRun(mode, cgTemplateText(slot, mode === 'nai' ? 2 : undefined,
            [{ key: 'Bob', token: 'r1', frame: 'portrait', identity }]), assets, 1);
        try {
            assert.equal(run.result.ok, true, run.result.error);
            const first = await run.store.getSlotRecord(`c1|5|0|${slot}`);
            assert.equal(first.dnaSnapshot.characters[0].source, 'scene');
            assert.equal(first.dnaSnapshot.characters[0].dnaVersion, 0);
            assert.equal(first.characterMeta.characters[0].identityAnchor, identity);
            assert.equal(first.characterMeta.characters[0].signatureDetails, 'silver hair clip');
            assert.equal(first.dnaCandidates, undefined);
            assert.equal(run.wires.length, 1);
            assert.equal((await run.service.rerollSlot({ chatId: 'c1', messageId: 5, swipeId: 0, slot })).ok, true);
            const second = await run.store.getSlotRecord(`c1|5|0|${slot}`);
            assert.equal(second.dnaSnapshot.characters[0].source, 'scene');
            assert.equal(second.dnaSnapshot.characters[0].subject, identity);
            assert.equal(run.wires.length, 2);
            assert.equal(run.llmRequests.length + run.writes.length, 1, '重画复用当次描述，不追加写词');
            assets.characterDna.Bob = cgTemplateAssets().characterDna.Bob;
            assert.equal((await run.service.rerollSlot({ chatId: 'c1', messageId: 5, swipeId: 0, slot })).ok, true);
            const upgraded = await run.store.getSlotRecord(`c1|5|0|${slot}`);
            assert.equal(upgraded.dnaSnapshot.characters[0].source, 'saved');
            delete assets.characterDna.Bob;
            assert.deepEqual(assets, before, 'CG 与重画不登记或改写角色 DNA');
            assert.equal(run.llmRequests.length + run.writes.length, 1);
        } finally { run.dispose(); }
    });
}

for (const mode of ['nai', 'dbgen']) {
    test(`gate:cg-template:${mode}:缺模板拒发不增加写词`, async () => {
        const assets = cgTemplateAssets();
        const reply = cgTemplateText(mode === 'nai' ? 1 : 6, mode === 'nai' ? 2 : undefined,
            [{ key: 'Alice', token: 'r0' }]).replace('prompt_mode: dna_template\n', '');
        const run = await cgTemplateRun(mode, reply, assets, 1);
        try {
            assert.equal(run.result.ok, false);
            assert.equal(run.wires.length, 0);
            assert.equal(run.llmRequests.length + run.writes.length, 1);
            assert.deepEqual(await run.store.getSlots('c1|5|0'), []);
        } finally { run.dispose(); }
    });
    test(`gate:cg-template:${mode}:重画身份缺失保留原图并报告失败`, async () => {
        const assets = cgTemplateAssets(), slot = mode === 'nai' ? 1 : 6;
        const run = await cgTemplateRun(mode, cgTemplateText(slot, mode === 'nai' ? 2 : undefined,
            [{ key: 'Alice', token: 'r0' }]), assets, 1);
        try {
            assert.equal(run.result.ok, true, run.result.error);
            const old = await run.store.getSlotRecord(`c1|5|0|${slot}`);
            delete assets.characterDna.Alice;
            const failed = await run.service.rerollSlot({ chatId: 'c1', messageId: 5, swipeId: 0, slot });
            assert.equal(failed.ok, false);
            assert.equal(failed.count, 0);
            assert.equal(failed.failedCount, 1);
            const kept = await run.store.getSlotRecord(`c1|5|0|${slot}`);
            assert.equal(kept.dataUrl, old.dataUrl);
            assert.deepEqual(kept.caption, old.caption);
            assert.deepEqual(kept.prompt, old.prompt);
            assert.deepEqual(kept.promptRecipe, old.promptRecipe);
            assert.deepEqual(kept.dnaSnapshot, old.dnaSnapshot);
            assert.deepEqual(kept.sentPrompt, old.sentPrompt);
            assert.equal(kept.status, 'done', '已存在原图仍可显示，不表示本次重画成功');
            assert.equal(kept.failureReason, 'DNA_MISSING');
            assert.equal(run.wires.length, 1);
            assert.equal(run.llmRequests.length + run.writes.length, 1);
        } finally { run.dispose(); }
    });
}

// 使用真实 IGS Adapter、DBGen workbench/网关；仅 LLM、网络和像素编解码为隔离端口。
async function consistencyAdapterFixture(count, wrapStore = (store) => store, options = {}) {
    const { createImageBackend } = await import('../src/generated-images/image-backend.js');
    const { createCgConsistencyService } = await import('../src/generated-images/illustration/cg-consistency-service.js');
    const { createIndexedDbIllustrationStore } = await import('../src/media/illustration-store.js');
    const { createTransactionalIdb } = await import('./helpers/transactional-idb.js');
    const { buildPipeline } = await import('../../../nai-dbgen/tests/application/_fakes.js');
    const { Ok } = await import('../../../nai-dbgen/src/infra/result.js');
    const { createImageGenService } = await import('../../../nai-dbgen/src/application/image-gen.service.js');
    const { createNaiGateway } = await import('../../../nai-dbgen/src/adapters/nai/nai.gateway.js');
    const { createDirectTransport } = await import('../../../nai-dbgen/src/adapters/nai/transport/direct.js');
    const { defaultPluginSettings } = await import('../../../nai-dbgen/src/domain/model/plugin-settings.js');
    const { createMemoryIdb } = await import('../../../nai-dbgen/src/adapters/storage/memory-idb.js');
    const { createNaiConfigRepo } = await import('../../../nai-dbgen/src/adapters/storage/repos/api-config.repo.js');
    const indexedDB = createTransactionalIdb();
    const rawStore = createIndexedDbIllustrationStore({ indexedDB });
    const f = await consistencyFixture(count, rawStore);
    const store = wrapStore(rawStore);
    const originalAssets = structuredClone(f.assets), wires = [], edits = [], writes = [];
    let serial = 0, pipeline;
    const pipelines = [];
    const png = (pixels) => {
        const bytes = new Uint8Array(36);
        bytes.set([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82]);
        const header = new DataView(bytes.buffer);
        header.setUint32(16, pixels.width); header.setUint32(20, pixels.height);
        header.setUint32(32, ++serial);
        const url = 'data:image/png;base64,' + Buffer.from(bytes).toString('base64');
        f.pixels.set(url, pixels);
        return { url, bytes };
    };
    const codec = { ...f.codec, async encodePixels(pixels) { return png(pixels).url; } };
    const settings = { ...defaultPluginSettings(), activeNaiConfigId: 'fake', activeArtistId: 'artist' };
    settings.naiParams = { ...settings.naiParams, model: 'nai-diffusion-5-full' };
    const gateway = createNaiGateway({ transports: { direct: createDirectTransport({ fetch: async (_url, init) => {
        wires.push(JSON.parse(init.body));
        return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
    } }) }, decoders: { 'json-base64': { decode: async () => {
        const { width, height } = wires.at(-1).parameters;
        const data = new Uint8ClampedArray(width * height * 4);
        for (let i = 0; i < data.length; i += 4) data.set([220, wires.length * 40, 20, 255], i);
        return Ok([{ blob: new Blob([png({ width, height, data }).bytes], { type: 'image/png' }), mimeType: 'image/png' }]);
    } } } });
    const configDb = createMemoryIdb(), configRepo = createNaiConfigRepo({ db: configDb});
    const config = { schemaVersion: 1, id: 'fake', name: 'fixture', baseUrl: 'https://example.invalid',
        apiKey: 'fake-key', transport: 'direct', decoder: 'json', createdAt: 't', updatedAt: 't' };
    assert.equal((await configRepo.put(config)).ok, true);
    const otherConfigRepo = createNaiConfigRepo({ db: configDb });
    const imageService = createImageGenService({ imageGenPort: gateway, loadSettings: () => settings,
        naiConfigRepo: configRepo,
        artistRepo: { get: async () => Ok({ positivePrompt: 'artist:test', negativePrompt: 'artist-uc' }), onChanged: () => () => {} },
        newTraceId: () => 'consistency-offline' });

    const api = { getPromptCapabilities: () => ({ finalCaption: 1, promptSnapshot: 1, generationConfig: 1, generationConfigLease: 1 }),
        getGenerationConfig: () => imageService.getGenerationConfig(),
        isGenerationConfigCurrent: (token) => imageService.isGenerationConfigCurrent(token),
        describeInfill: () => imageService.describeInfill(),
        async generateSinglePrompt(request) {
            writes.push(request);
            const output = await f.backend.writeDbgenPrompt(request);
            const reply = output.captions.map((entry) => {
                const pos = entry.caption.v4_prompt.caption, neg = entry.caption.v4_negative_prompt.caption;
                return [`slotid: ${entry.slotId}`, 'prompt_mode: dna_template',
                    `scene: ${pos.base_caption} High quality illustration.`,
                    `scene_uc: ${['blurry', neg.base_caption].filter(Boolean).join(', ')}`,
                    ...entry.promptRecipe.bindings.flatMap((b) => {
                        const meta = entry.characterMeta.characters.find((c) => c.captionIndex === b.captionIndex);
                        const center = pos.char_captions[b.captionIndex].centers[0];
                        return [`char: ${center.x},${center.y} | ${pos.char_captions[b.captionIndex].char_caption}`,
                            `char_uc: ${neg.char_captions[b.captionIndex].char_caption}`,
                            `meta_kind: ${b.captionIndex} | ${b.kind}`, `meta_key: ${b.captionIndex} | ${b.characterKey}`,
                            `meta_token: ${b.captionIndex} | ${b.token}`, `meta_frame: ${b.captionIndex} | ${b.framing}`,
                            `meta_outfit_name: ${b.captionIndex} | ${meta?.outfit.name || ''}`,
                            `meta_outfit_description: ${b.captionIndex} | ${meta?.outfit.description || ''}`,
                            ...Object.entries(entry.dnaCandidates?.characters.find((c) => c.characterKey ===b.characterKey)?.views || {})
                                .flatMap(([frame, view]) => [
                                    `meta_dna_${frame}: ${b.captionIndex} | ${view.subject}`,
                                    `meta_dna_uc_${frame}: ${b.captionIndex} | ${view.negative || ''}`,
                                ])];
                    })].join('\n');
            }).join('\n---\n');
            pipeline = buildPipeline({ llmComplete: async () => Ok({ text: reply, json: null }) });
            pipelines.push(pipeline);
            options.preparePipeline?.(pipeline, request);
            return pipeline.workbench.writePrompt({ mode: 'floor', skipRecall: request.skipRecall, messageId: request.messageId,
                naturalLanguage: request.description, characterContext: request.characterContext,
                promptTask: request.promptTask, writingRequirements: request.writingRequirements });
        },
        async generate(request) { return imageService.generate(request); },
    };
    const backend = createImageBackend({ global: { NaiDbGen: api },
        getBridge: () => ({ imageApi: { mode: 'dbgen' } }) });
    const service = createCgConsistencyService({ store, nai: { ...backend,
        async edit(request) { edits.push(request); return backend.edit(request); } }, codec,
        getSceneAssets: () => f.assets,
        consistencyStrength: () => f.igsSettings.autoIllustration?.consistencyStrength,
        resolveReference: options.resolveReference || ((key, assets) => assets.characters[key].默认),
        ...(options.onAccepted && { onAccepted: options.onAccepted }),
        targetStillLive: () => true, writingRequirements: () => ({ transparent: false,
            quality: 'High quality illustration.', undesiredContent: 'blurry' }) });
    return { ...f, store, rawStore, service, codec, indexedDB, originalAssets, wires, edits, writes, settings,
        api, adapter: backend, config, configRepo, otherConfigRepo, imageService, pipelines,
        target: { key: f.key, floor: f.floor, slot: 7 }, dispose: () => imageService.dispose(),
        get pipeline() { return pipeline; } };
}


for (const count of [2, 3]) test(`gate:cg-consistency:${count}-characters-real-adapter-wire-and-idb`, async () => {
    const { prepareCharacterCaption } = await import('../src/generated-images/character-caption.js');
    const { promptSnapshotFromBody } = await import('../src/generated-images/final-caption.js');
    const { createIndexedDbIllustrationStore } = await import('../src/media/illustration-store.js');
    const f = await consistencyAdapterFixture(count);
    try {
        const original = prepareCharacterCaption({ ...f.before, caption: f.before.promptRecipe.caption,
            characterContext: f.names.map((characterKey) => ({ characterKey, dna: f.assets.characterDna[characterKey] })) });
        assert.equal(original.ok, true, original.error);
        const oldWire = promptSnapshotFromBody({ model: 'nai-diffusion-5-full', action: 'generate', parameters: original.caption }, null);
        const before = await f.store.putSlot(f.key, { ...f.before, caption: original.caption,
            dnaSnapshot: original.dnaSnapshot, sentPrompt: oldWire });
        const candidate = await f.service.run(f.target);
        assert.equal(candidate.ok, true, JSON.stringify(candidate));
        assert.equal(f.writes.length, count + 1);
        assert.equal(f.pipelines.reduce((sum, p) => sum + p.llmCalls.length, 0), count + 1);
        assert.equal(f.wires.length, count);
        assert.equal(f.edits.length, count);
        assert.equal(f.writes[0].skipRecall, true);
        assert.equal(f.writes[0].imageDataUrl, undefined, '不向写词模型发送图片定位');
        assert.ok(f.writes.every((request) => request.promptTask.slots.length === 1));
        assert.match(f.pipeline.llmCalls[0].messages.at(-1).content, /High quality illustration/);
        assert.deepEqual(await f.store.getSlotRecord(before.key), before, '候选期间不写正式记录');
        for (const [i, wire] of f.wires.entries()) {
            const prepared = prepareCharacterCaption(f.edits[i]);
            assert.equal(prepared.ok, true, prepared.error);
            assert.equal(wire.action, 'infill');
            assert.equal(wire.input, 'artist:test, ' + prepared.caption.v4_prompt.caption.base_caption);
            assert.doesNotMatch(wire.input, /reference inset|frame|border|split screen|collage/i);
            assert.equal(wire.parameters.negative_prompt, 'artist-uc, ' + prepared.caption.v4_negative_prompt.caption.base_caption);
            assert.match(wire.parameters.negative_prompt, /decorative frame, golden border, split screen, collage, duplicate person/);
            assert.equal(wire.parameters.strength, 0.75, '一致性专用强度透传到最终 wire');
            assert.equal(wire.parameters.noise, 0);
            assert.deepEqual(wire.parameters.v4_prompt.caption.char_captions, prepared.caption.v4_prompt.caption.char_captions);
            assert.deepEqual(wire.parameters.v4_negative_prompt.caption.char_captions.map((c) => c.char_caption),
                prepared.caption.v4_negative_prompt.caption.char_captions.map((c) => c.char_caption));
            assert.deepEqual(wire.parameters.v4_negative_prompt.caption.char_captions.map((c) => c.centers),
                prepared.caption.v4_prompt.caption.char_captions.map((c) => c.centers),
                '负向缺省坐标按既有 NAI 协议复制正向坐标');
            assert.ok(prepared.dnaSnapshot.characters.some((c) => c.kind === 'reference'
                && c.characterKey === f.names[i] && c.framing === 'portrait'));
            assert.equal(JSON.stringify(wire).includes('<<dna'), false);
            assert.equal(wire.parameters.width * wire.parameters.height <= 1024 * 1024, true);
        }

        assert.equal((await f.service.accept(candidate.candidateId)).ok, true);
        const saved = await createIndexedDbIllustrationStore({ indexedDB: f.indexedDB }).getSlotRecord(before.key);
        assert.equal(saved.dataUrl, candidate.dataUrl);
        assert.equal(saved.sentPrompt, undefined, '合成 CG 不沿用旧整图 wire');
        assert.equal(saved.prompt.sentPrompt, undefined);
        assert.equal(saved.consistencyPrompt.rounds.length, count);
        assert.deepEqual(saved.consistencyBaselineMeta.sentPrompt, oldWire);
        assert.ok(saved.promptRecipe.bindings.every((b) => b.kind === 'named'));
        assert.equal(saved.caption.v4_prompt.caption.base_caption.includes('reference inset'), false);
        for (const [i, round] of saved.consistencyPrompt.rounds.entries()) {
            assert.equal(round.slotId, i + 2);
            assert.equal(round.characterKey, f.names[i]);
            assert.equal(round.sentPrompt.action, 'infill');
            assert.deepEqual(round.sentPrompt.caption.v4_prompt.caption, f.wires[i].parameters.v4_prompt.caption);
            assert.deepEqual(round.sentPrompt.caption.v4_negative_prompt.caption, f.wires[i].parameters.v4_negative_prompt.caption);
            assert.ok(round.dnaSnapshot.characters.every((c) => c.source === 'saved'));
        }
        assert.deepEqual(f.assets, f.originalAssets, '全过程不写 DNA 或衣装');
        assert.equal(JSON.stringify(saved.consistencyPrompt).includes('fake-key'), false);
    } finally { f.dispose(); }
});

test('gate:cg-consistency:DNA changes before writing, during edits and at commit preserve original', async () => {
    const { createIndexedDbIllustrationStore } = await import('../src/media/illustration-store.js');
    const { createTransactionalIdb } = await import('./helpers/transactional-idb.js');
    for (const phase of ['reference', 'write', 'edit', 'candidate', 'commit']) {
        const store = createIndexedDbIllustrationStore({ indexedDB: createTransactionalIdb() });
        const f = await consistencyFixture(2, store);
        const mutate = () => { f.assets.characterDna.A.views.half_body.subject = 'changed-A'; };
        if (phase === 'reference') {
            const decode = f.codec.decodeImage;
            f.codec.decodeImage = async (src) => { const result = await decode(src); if (src === 'reference-A') mutate(); return result; };
        }
        if (phase === 'write') {
            const write = f.backend.writeDbgenPrompt;
            f.backend.writeDbgenPrompt = async (req) => { const result = await write(req); mutate(); return result; };
        }
        if (phase === 'edit') {
            const edit = f.backend.edit;
            f.backend.edit = async (req) => { const result = await edit(req); mutate(); return result; };
        }
        const result = await f.service.redrawConsistency(f.query);
        if (['candidate', 'commit'].includes(phase)) {
            assert.equal(result.ok, true, JSON.stringify(result));
            if (phase === 'candidate') mutate();
            else {
                const update = store.updateSlot;
                store.updateSlot = async (...args) => { mutate(); return update(...args); };
            }
            assert.equal((await f.service.acceptConsistency(result.candidateId)).reason, 'stale-dna', phase);
        } else assert.equal(result.reason, 'stale-dna', phase);
        assert.equal(f.writes.length, phase === 'reference' ? 0 : phase === 'write' ? 1 : 3, phase);
        assert.equal(f.calls.length, ['reference', 'write'].includes(phase) ? 0 : phase === 'edit' ? 1 : 2, phase);
        assert.deepEqual(await store.getSlotRecord(f.before.key), f.before, phase);
        assert.equal(f.events.some((e) => e.name === 'igs:illustration-updated'), false, phase);
    }
});

test('gate:cg-consistency:缺轮次错绑和非法来源在发送前拒绝', async () => {
    for (const mode of ['missing', 'duplicate', 'key', 'token', 'frame', 'outfit', 'candidate']) {
        const f = await consistencyFixture();
        const write = f.backend.writeDbgenPrompt;
        f.backend.writeDbgenPrompt = async (request) => {
            const result = await write(request);
            const entry = result.captions.find((c) => c.slotId === 2);
            if (!entry) return result;
            const named = entry.promptRecipe.bindings.find((b) => b.kind === 'named');
            if (mode === 'missing') result.captions.pop();
            if (mode === 'duplicate') result.captions[0].slotId = 1;
            if (mode === 'key') named.characterKey = 'B';
            if (mode === 'token') named.token = 'unknown';
            if (mode === 'frame') named.framing = 'full_body';
            if (mode === 'outfit') entry.characterMeta.characters[0].outfit.description = 'other outfit';
            if (mode === 'candidate') entry.dnaCandidates = { version: 1, characters: [] };
            return result;
        };
        const result = await f.service.redrawConsistency(f.query);
        assert.equal(result.ok, false, mode);
        assert.equal(f.writes.length, 3, mode);
        assert.equal(f.calls.length, 0, mode);
        assert.deepEqual(await f.store.getSlotRecord(f.before.key), f.before, mode);
    }
});

test('gate:cg-consistency:真实 Adapter 配置变化停止下一轮或接受', async () => {
    for (const phase of ['write', 'edit', 'candidate']) {
        const f = await consistencyAdapterFixture(2);
        try {
            if (phase === 'write') {
                const write = f.backend.writeDbgenPrompt;
                f.backend.writeDbgenPrompt = async (req) => {
                    const result = await write(req);
                    f.settings.naiParams.scale += 1;
                    return result;
                };
            }
            if (phase === 'edit') {
                const decode = f.codec.decodeImage;
                f.codec.decodeImage = async (src) => {
                    const result = await decode(src);
                    if (String(src).startsWith('data:image/') && f.wires.length > 0) f.settings.naiParams.scale += 1;
                    return result;
                };
            }
            const result = await f.service.run(f.target);
            if (phase === 'candidate') {
                assert.equal(result.ok, true, JSON.stringify(result));
                f.settings.naiParams.scale += 1;
                assert.equal((await f.service.accept(result.candidateId)).reason, 'stale-config');
            } else assert.equal(result.reason, 'stale-config', phase);
            assert.equal(f.writes.length, phase === 'write' ? 1 : 3);
            assert.equal(f.wires.length, phase === 'write' ? 0 : 2);
            assert.deepEqual(await f.store.getSlotRecord(f.before.key), f.before);
            assert.deepEqual(f.assets, f.originalAssets);
        } finally { f.dispose(); }
    }
});


for (const phase of ['preflight', 'transaction', 'transaction-revert']) test(`gate:cg-consistency:接受候选 ${phase} 配置失效保留原记录`, async () => {
    const f = await consistencyAdapterFixture(2);
    try {
        const candidate = await f.service.run(f.target);
        assert.equal(candidate.ok, true, JSON.stringify(candidate));
        const change = async () => {
            assert.equal((await f.otherConfigRepo.put({ ...f.config, apiKey: 'fixture-rotated-key' })).ok, true);
            if (phase === 'transaction-revert') assert.equal((await f.otherConfigRepo.put(f.config)).ok, true);
        };
        const update = f.rawStore.updateSlot;
        f.rawStore.updateSlot = async (...args) => {
            if (phase === 'preflight') await change();
            else {
                const options = args[4], preflight = options.beforeCommit;
                args[4] = { ...options, async beforeCommit() {
                    await preflight();
                    await change();
                } };
            }
            return update(...args);
        };
        const result = await f.service.accept(candidate.candidateId);
        assert.equal(result.reason, 'stale-config', JSON.stringify(result));
        assert.deepEqual(await f.rawStore.getSlotRecord(f.before.key), f.before);
        assert.deepEqual(f.assets, f.originalAssets);
        assert.equal(f.writes.length, 3);
        assert.equal(f.wires.length, 2);
        assert.equal(f.service.isBusy(), false);
    } finally { f.dispose(); }
});

for (const mode of ['missing', 'async', 'false', 'throw']) test(`gate:cg-consistency:租约守卫 ${mode} 在写词前拒绝`, async () => {
    const f = await consistencyAdapterFixture(2);
    try {
        f.api.isGenerationConfigCurrent = mode === 'missing' ? undefined
            : mode === 'async' ? async () => true
            : mode === 'throw' ? () => { throw new Error('fixture-private'); } : () => false;
        const result = await f.service.run(f.target);
        assert.equal(result.ok, false);
        assert.equal(result.reason, 'generation-config-unavailable');
        assert.equal(f.writes.length, 0);
        assert.equal(f.wires.length, 0);
        assert.deepEqual(await f.rawStore.getSlotRecord(f.before.key), f.before);
    } finally { f.dispose(); }
});


for (const phase of ['upload', 'transaction', 'accepted']) test(`gate:cg-consistency:实际接受链路文件上传 ${phase} 配置租约`, async () => {
    const { withTavernIllustrationFiles } = await import('../src/media/tavern-image-files.js');
    const uploaded = [], deleted = [];
    let f;
    const globalObject = {
        setTimeout, clearTimeout,
        btoa: (value) => Buffer.from(value, 'binary').toString('base64'),
        SillyTavern: { getContext: () => ({ getRequestHeaders: () => ({}) }) },
        async fetch(url, options = {}) {
            if (url === '/api/images/upload') {
                const body = JSON.parse(options.body), path = `user/images/igs-cg/${body.filename}.png`;
                uploaded.push(path);
                if (phase === 'upload') assert.equal((await f.otherConfigRepo.put({ ...f.config, apiKey: 'fixture-upload-rotation' })).ok, true);
                return { ok: true, json: async () => ({ path }) };
            }
            if (url === '/api/images/delete') { deleted.push(JSON.parse(options.body).path); return { ok: true }; }
            return { ok: false, status: 404 };
        },
    };
    f = await consistencyAdapterFixture(2, (raw) => withTavernIllustrationFiles(raw, globalObject));
    try {
        const candidate = await f.service.run(f.target);
        assert.equal(candidate.ok, true, JSON.stringify(candidate));
        if (phase === 'transaction') {
            const update = f.rawStore.updateSlot;
            f.rawStore.updateSlot = async (...args) => {
                assert.equal(args[4].beforeCommit, undefined, '上传后复核已由文件层消费');
                assert.equal((await f.otherConfigRepo.put({ ...f.config, apiKey: 'fixture-transaction-rotation' })).ok, true);
                return update(...args);
            };
        }
        const result = await f.service.accept(candidate.candidateId);
        assert.equal(result.ok, phase === 'accepted', JSON.stringify(result));
        assert.equal(uploaded.length, 1);
        const saved = await f.rawStore.getSlotRecord(f.before.key);
        if (phase === 'accepted') {
            assert.equal(saved.dataUrl, uploaded[0]);
            assert.equal(saved.consistencyPrompt.rounds.length, 2);
            assert.equal(saved.consistencyBaselineDataUrl, f.before.dataUrl);
            assert.equal(saved.sentPrompt, undefined);
            assert.deepEqual(deleted, []);
        } else {
            assert.equal(result.reason, 'stale-config');
            assert.deepEqual(saved, f.before);
            assert.deepEqual(deleted, uploaded);
        }
        assert.equal(f.writes.length, 3);
        assert.equal(f.wires.length, 2);
        assert.equal(f.service.isBusy(), false);
        assert.deepEqual(f.assets, f.originalAssets);
    } finally { f.dispose(); }
});


for (const count of [2, 3]) test(`gate:dna-chain:${count}人采用到CG重画一致性与备份回读`, async () => {
    const { createAssetGenerationService } = await import('../src/generated-images/illustration/asset-generation-service.js');
    const { createIndexedDbGeneratedAssetStore } = await import('../src/media/generated-asset-store.js');
    const { createIndexedDbIllustrationStore } = await import('../src/media/illustration-store.js');
    const { withTavernIllustrationFiles, CG_RECORDS_FILE } = await import('../src/media/tavern-image-files.js');
    const { createTransactionalIdb } = await import('./helpers/transactional-idb.js');
    const { prepareSpriteIdentityAdoption } = await import('../src/scene/character-identity.js');
    const { characterWriteFixture } = await import('./helpers/prompt-provenance.js');
    const files = new Map(), deleted = [];
    let backup, sprites, sequence = 0;
    const globalObject = {
        // 只加速备份 debounce，恢复期限必须容纳真实异步存储事务。
        setTimeout: (fn, ms) => setTimeout(fn, ms === 2000 ? 5 : ms), clearTimeout,
        btoa: (value) => Buffer.from(value, 'binary').toString('base64'),
        FileReader: class { readAsDataURL(blob) { blob.text().then((value) => {
            this.result = 'data:image/png;base64,' + value; this.onload();
        }); } },
        SillyTavern: { getContext: () => ({ getRequestHeaders: () => ({}) }) },
        async fetch(url, options = {}) {
            if (String(url).startsWith(`/user/files/${CG_RECORDS_FILE}`)) return backup
                ? { ok: true, json: async () => structuredClone(backup) } : { ok: false, status: 404 };
            if (url === '/api/files/upload') {
                backup = JSON.parse(Buffer.from(JSON.parse(options.body).data, 'base64').toString('utf8'));
                return { ok: true };
            }
            if (url === '/api/images/upload') {
                const body = JSON.parse(options.body), path = `user/images/igs-cg/${body.filename}.png`;
                files.set(path, body.image);
                return { ok: true, json: async () => ({ path }) };
            }
            if (url === '/api/images/delete') {
                const path = JSON.parse(options.body).path; deleted.push(path); files.delete(path);
                return { ok: true };
            }
            const path = String(url).replace(/^\//, '');
            return files.has(path) ? { ok: true, blob: async () => new Blob([files.get(path)]) }
                : { ok: false, status: 404 };
        },
    };
    const f = await consistencyAdapterFixture(count, (raw) => withTavernIllustrationFiles(raw, globalObject), {
        resolveReference: async (key, assets) => (await sprites.readStoredImage(
            assets.characters[key].默认.slice('igs-gen:'.length))).dataUrl,
        preparePipeline(pipeline, request) {
            if (request.promptTask.purpose !== 'cg') return;
            pipeline.host.byId.set(5, { messageId: 5, name: 'Bot', isUser: false, isSystem: false,
                text: NSFW_TEXT + '\n' + ['A', 'B', 'C'].slice(0, count).map((name) =>
                    `[igs-char:${name}|smile|Hello]`).join('\n') });
            pipeline.tagRecall.recall = async () => ({ ok: true, value: {
                positions: [{ slotId: 1, anchorSentence: '二段。', keys: [] }], unmatchedKeys: [] } });
        },
    });

    let cg;
    try {
        f.assets.characterDna = {};
        f.assets.characters = Object.fromEntries(f.names.map((name) => [name, {}]));
        const consistencyWrite = f.backend.writeDbgenPrompt;
        f.backend.writeDbgenPrompt = async (request) => {
            if (request.promptTask.purpose === 'consistency') return consistencyWrite(request);
            const name = request.promptTask.characters[0].characterKey;
            const output = characterWriteFixture(request, { subject: `${name}, an adult with silver hair and blue eyes,`,
                scene: 'Adults meet in a cafe.', action: 'wears a blue coat and waves.' });
            for (const entry of output.captions) {
                // 普通 CG 输入是允许池；本次模拟写词结果显式选择景别。
                if (request.promptTask.purpose === 'cg') {
                    entry.promptRecipe.bindings.forEach((binding) => { binding.framing = 'half_body'; });
                    entry.characterMeta.characters.forEach((meta, index) => {
                        const centers = [{ x: (index + 0.5) / count, y: 0.5 }];
                        meta.centers = centers;
                        entry.caption.v4_prompt.caption.char_captions[index].centers = centers;
                        entry.caption.v4_negative_prompt.caption.char_captions[index].centers = centers;
                    });
                }
                for (const meta of entry.characterMeta.characters) {
                    meta.outfit = { name: '冬装', description: `coat-${meta.characterKey}` };
                    entry.caption.v4_prompt.caption.char_captions[meta.captionIndex].char_caption =
                        `<<dna:${entry.promptRecipe.bindings[meta.captionIndex].token}>> wears coat-${meta.characterKey}.`;
                }
                for (const candidate of entry.dnaCandidates?.characters || []) {
                    candidate.views.portrait.subject = `${candidate.characterKey}, an adult with silver hair and blue eyes,`;
                }
            }
            return output;
        };
        const assetIdb = createTransactionalIdb();
        const openSprites = () => createAssetGenerationService({ nai: f.adapter,
            store: createIndexedDbGeneratedAssetStore({ indexedDB: assetIdb }),
            messageHost: { getChatId: () => 'c1' }, llm: {},
            getSettings: () => ({ autoIllustration: {}, sceneAssets: f.assets }), report() {},
            newId: () => `chain-sprite-${++sequence}`, matte: async (url) => url });
        sprites = openSprites();
        for (const name of f.names) {
            const generated = await sprites.generateCharacterSprite({ name, dna: {} });
            assert.equal(generated.ok, true, JSON.stringify(generated));
            assert.equal(f.assets.characterDna[name], undefined, '生成成功不登记身份');
            const record = await openSprites().readStoredImage(generated.imageId);
            assert.equal(record.sentPrompt.action, 'generate');
            const adoption = prepareSpriteIdentityAdoption(f.assets, name, record.id, record);
            assert.equal(adoption.ok, true, JSON.stringify(adoption));
            Object.assign(f.assets, adoption.patch);
            f.assets.characters[name].默认 = `igs-gen:${record.id}`;
            assert.deepEqual(f.assets.characterDna[name].views, record.dnaCandidates.characters[0].views);
        }
        const adopted = structuredClone(f.assets);
        assert.equal(f.writes.length, count, '每张立绘同次写词产生三景别');
        assert.equal(f.wires.length, count);
        cg = await cgTemplateRun('dbgen', '', f.assets, 1, { store: f.store, backend: f.adapter });
        assert.equal(cg.result.ok, true, JSON.stringify(cg.result));
        assert.equal(f.writes.length, count + 1, '普通 CG 只用一次写词');
        const key = 'c1|5|0|1';
        const original = await f.rawStore.getSlotRecord(key);
        assert.equal(original.characterMeta.characters.length, count);
        assert.ok(original.dnaSnapshot.characters.every((c) => c.source === 'saved'));
        assert.deepEqual(f.assets, adopted, 'CG 不改身份或采用资料');
        const firstName = f.names[0];
        f.assets.characterDna[firstName].views.half_body.subject = `${firstName}, an adult with black hair and blue eyes,`;
        const target = { key: 'c1|5|0', floor: cg.fake.messageHost.readFloor(5), slot: 1 };
        assert.equal((await cg.service.rerollSlot({ chatId: 'c1', messageId: 5, swipeId: 0, slot: 1 })).ok, true);
        const redrawn = await f.rawStore.getSlotRecord(key);
        assert.equal(redrawn.dnaSnapshot.characters.find((c) => c.characterKey === firstName).subject,
            f.assets.characterDna[firstName].views.half_body.subject);
        assert.notEqual(original.dnaSnapshot.characters[0].subject, redrawn.dnaSnapshot.characters[0].subject);
        assert.equal(f.writes.length, count + 1, '模板重画不再次写词');
        const currentAssets = structuredClone(f.assets);
        const candidate = await f.service.run(target);
        assert.equal(candidate.ok, true, JSON.stringify(candidate));
        assert.equal(f.writes.length, count * 2 + 2, '一致性场景与各工作轮次各写一次');
        assert.equal(f.wires.length, count * 2 + 2, '立绘、CG、重画和逐角色 infill 的实际发送数');
        assert.equal((await f.service.accept(candidate.candidateId)).ok, true);
        const saved = await createIndexedDbIllustrationStore({ indexedDB: f.indexedDB }).getSlotRecord(key);
        assert.equal(saved.consistencyPrompt.rounds.length, count);
        assert.equal(saved.sentPrompt, undefined);
        assert.deepEqual(saved.consistencyBaselineMeta.sentPrompt, redrawn.sentPrompt);
        assert.equal(saved.consistencyBaselineDataUrl, redrawn.dataUrl);
        assert.equal(deleted.includes(redrawn.dataUrl), false);
        await new Promise((resolve) => setTimeout(resolve, 40));
        assert.ok(backup?.slots?.[key], '接受后的记录确实上传到备份');
        const fresh = createIndexedDbIllustrationStore({ indexedDB: createTransactionalIdb() });
        const restored = withTavernIllustrationFiles(fresh, globalObject);
        await restored.listSlotKeys();
        const copy = await fresh.getSlotRecord(key);
        assert.ok(copy, '备份恢复后从权威存储回读记录');
        for (const field of ['prompt', 'promptRecipe', 'dnaSnapshot', 'characterMeta', 'consistencyPrompt', 'consistencyBaselineMeta'])
            assert.deepEqual(copy[field], saved[field], field);
        assert.equal((await restored.getSlots(target.key)).find((r) => r.slot === 1).dataUrl, candidate.dataUrl);
        const { createCgLibrary } = await import('../src/media/cg-library.js');
        const library = createCgLibrary({ illustrationStore: restored });
        assert.deepEqual(await library.readFull({ key, kind: 'cg' }),
            { ok: true, dataUrl: candidate.dataUrl }, '图库从恢复后的权威记录读取采用图片');
        assert.deepEqual(f.assets, currentAssets, '一致性及恢复不写 DNA');
        assert.equal(f.service.isBusy(), false);
    } finally { cg?.dispose(); f.dispose(); }
});

for (const mode of ['outfit', 'missing']) test(`gate:cg-consistency:诊断日志 ${mode} 可回读且拒发`, async () => {
    const { createImageJobLog } = await import('../src/generated-images/image-job-log.js');
    const f = await consistencyFixture();
    const write = f.backend.writeDbgenPrompt;
    f.backend.writeDbgenPrompt = async (request) => {
        const reply = await write(request);
        if (!reply.captions.some((entry) => entry.slotId === 2)) return reply;
        if (mode === 'missing') reply.captions.pop();
        else reply.captions.find((entry) => entry.slotId === 2).characterMeta.characters[0].outfit.description = 'PRIVATE-OUTFIT-CONTENT';
        return reply;
    };
    const result = await f.service.redrawConsistency(f.query);
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'DNA_TEMPLATE_BINDING');
    assert.equal(result.diagnostics.field, mode === 'outfit' ? 'outfit.description' : 'captions.length');
    assert.match(result.error, mode === 'outfit' ? /slotid 2.*outfit.description/ : /captions.length/);
    if (mode === 'outfit') assert.equal(result.diagnostics.slotId, 2);
    assert.equal(f.calls.length, 0);
    assert.equal(f.writes.length, 3);
    assert.deepEqual(await f.store.getSlotRecord(f.before.key), f.before);
    const recovered = createImageJobLog({ storage: f.logStorage }).list();
    assert.ok(recovered.some((entry) => entry.level === 'error' && entry.message.includes(result.diagnostics.field)));
    assert.ok(recovered.some((entry) => entry.message.includes('DNA_TEMPLATE_BINDING')));
    assert.equal(JSON.stringify(recovered).includes('PRIVATE-OUTFIT-CONTENT'), false);
    assert.equal(JSON.stringify(recovered).includes('new-A'), false);
});

test('gate:cg-consistency:写词约束明确照抄衣装且候选与接受日志可回读', async () => {
    const { createImageJobLog } = await import('../src/generated-images/image-job-log.js');
    const f = await consistencyFixture();
    const candidate = await f.service.redrawConsistency(f.query);
    assert.equal(candidate.ok, true, candidate.error);
    assert.match(f.writes[0].description, /meta_outfit_name.*meta_outfit_description.*逐字/);
    assert.match(f.writes[0].description, /允许修改的唯一范围.*DNA.*参照图/);
    assert.match(f.writes[0].description, /其他内容全部保持原 CG.*衣装颜色.*马匹.*光影/);
    assert.match(f.writes[0].description, /实际 Char 绘图正文.*原衣装.*颜色/);
    assert.match(f.writes[0].description, /工作模板 Scene 只描述原 CG.*不得把 reference inset/);
    assert.match(f.writes[0].description, /排除项写入工作轮次 scene_uc/);
    assert.equal(f.writes.length, 3, '场景和工作轮次各写一次，不额外补写身份');
    const pending = createImageJobLog({ storage: f.logStorage }).list();
    assert.ok(pending.some((entry) => entry.message.includes('候选已生成') && entry.message.includes('尚未保存')));
    assert.equal(pending.some((entry) => entry.message.includes('已接受并保存')), false);
    assert.equal((await f.service.acceptConsistency(candidate.candidateId)).ok, true);
    assert.ok(createImageJobLog({ storage: f.logStorage }).list().some((entry) => entry.message.includes('已接受并保存')));
});

test('gate:cg-consistency:实际接受同槽替换进入图库刷新并可删除', async () => {
    const { withCgIndexSync } = await import('../src/media/cg-library.js');
    const { createMemoryCgIndexStore } = await import('../src/media/cg-index-store.js');
    const { createMemoryCgGalleryStore } = await import('../src/media/cg-gallery-store.js');
    const { createMemoryPhotoAlbumStore } = await import('../src/media/photo-album.js');
    const { createItemAndCgServices } = await import('../src/core/item-cg-services.js');
    const { createCgLibraryView } = await import('../src/visual/igs-ui/cg-library-view.js');
    const listeners = new Set(), notified = [];
    const events = { on(name, handler) {
        assert.equal(name, 'igs:illustration-updated'); listeners.add(handler);
        return () => listeners.delete(handler);
    }, emit(name, payload) { notified.push({ name, payload }); for (const fn of listeners) fn(payload); } };
    const indexStore = createMemoryCgIndexStore();
    const f = await consistencyAdapterFixture(2, store => withCgIndexSync(store, indexStore), {
        onAccepted(target) { events.emit('igs:illustration-updated', { chatId: target.floor.chatId,
            messageId: target.floor.messageId, swipeId: target.floor.swipeId, slot: target.slot }); },
    });
    let view;
    try {
        const source = await f.codec.encodePixels(f.pixels.get('original'));
        const before = await f.store.putSlot(f.key, { ...f.before, dataUrl: source });
        const thumbOf = src => 'data:image/jpeg;base64,' + Buffer.from(src).toString('base64');
        const globalObject = { setTimeout, clearTimeout,
            Image: class {
                set src(value) {
                    this.source = value;
                    this.naturalWidth = 128; this.naturalHeight = 64;
                    queueMicrotask(() => this.onload());
                }
            },
            document: { createElement(tag) {
                assert.equal(tag, 'canvas');
                let image;
                return { getContext: () => ({ drawImage(value) { image = value; } }),
                    toDataURL: () => thumbOf(image.source) };
            } },
        };
        const { cgGallery } = createItemAndCgServices({ globalObject, events,
            illustrationStore: f.store, cgIndexStore: indexStore, itemImageService: {},
            cgGalleryStore: createMemoryCgGalleryStore(), photoAlbumStore: createMemoryPhotoAlbumStore(),
            clearIllustration: async query => {
                await f.store.deleteSlot(`${query.chatId}|${query.messageId}|${query.swipeId}`, query.slot);
                events.emit('igs:illustration-updated', query);
                return { ok: true };
            } });
        view = createCgLibraryView(cgGallery);
        await view.open(); await view.whenIdle();
        assert.equal(view.state.entries.length, 1);
        assert.equal(view.tileOf(before.key).url, thumbOf(source));
        const candidate = await f.service.run(f.target);
        assert.equal(candidate.ok, true, JSON.stringify(candidate));
        assert.equal(notified.length, 0, '候选不刷新正式图库');
        assert.equal((await f.store.getSlotRecord(before.key)).dataUrl, source);
        assert.equal((await f.service.accept(candidate.candidateId)).ok, true);
        await view.whenIdle();
        const entry = view.find(before.key);
        assert.ok(entry?.ready);
        assert.equal(view.state.entries.length, 1, '替换同槽，不额外新建图');
        assert.equal((await f.store.listSlotKeys()).length, 1);
        assert.equal(view.tileOf(entry.key).url, thumbOf(candidate.dataUrl));
        assert.equal((await cgGallery.readFull(entry)).dataUrl, candidate.dataUrl);
        const saved = await f.store.getSlotRecord(before.key);
        assert.equal(saved.consistencyBaselineDataUrl, source);
        assert.equal(entry.revisionToken, saved.revisionToken);
        assert.equal(notified.length, 1);
        assert.equal((await cgGallery.remove(entry)).ok, true);
        await view.whenIdle();
        assert.equal(await f.store.getSlotRecord(before.key), null);
        assert.equal((await indexStore.getAll()).length, 0);
        assert.equal(view.state.entries.length, 0);
    } finally { view?.dispose(); f.dispose(); }
    assert.equal(listeners.size, 0, '图库卸载解除订阅');
});

test('gate:cg-consistency:并发写词重绘同基线且乱序结果固定合成', { timeout: 5000 }, async () => {
    const { planReferenceCanvas, buildReferencePixels, composeReferencePixels } = await import('../src/media/cg-reference-canvas.js');
    const f = await consistencyFixture();
    const meta = structuredClone(f.before.characterMeta);
    meta.characters.forEach((c) => { c.region = { x: 0.1, y: 0.1, width: 0.8, height: 0.8 }; });
    await f.store.putSlot(f.key, { ...f.before, characterMeta: meta });
    const writes = [], edits = [], generated = new Map();
    let writingReady, editingReady;
    const writing = new Promise((resolve) => { writingReady = resolve; });
    const editing = new Promise((resolve) => { editingReady = resolve; });
    const write = f.backend.writeDbgenPrompt, edit = f.backend.edit;
    f.backend.writeDbgenPrompt = (req) => new Promise((resolve) => {
        writes.push({ req, resolve }); if (writes.length === 3) writingReady();
    });
    f.backend.edit = (req) => new Promise((resolve) => {
        edits.push({ req, resolve }); if (edits.length === 2) editingReady();
    });
    const pending = f.service.redrawConsistency(f.query);
    await writing;
    assert.equal(f.calls.length, 0, '写词尚未对账，不发送图像请求');
    for (const item of writes.slice().reverse()) item.resolve(await write(item.req));
    await editing;
    const baseline = structuredClone(f.pixels.get('original'));
    for (const item of edits.slice().reverse()) {
        const key = item.req.promptRecipe.bindings.find((b) => b.kind === 'reference').characterKey;
        const plan = planReferenceCanvas(128, 64, meta, key);
        const expected = buildReferencePixels(baseline, f.pixels.get(`reference-${key}`), plan);
        assert.deepEqual(f.pixels.get(item.req.sourceDataUrl), expected.image);
        const result = await edit(item.req);
        generated.set(key, f.pixels.get(result.dataUrl)); item.resolve(result);
    }
    const candidate = await pending;
    assert.equal(candidate.ok, true, JSON.stringify(candidate));
    assert.equal(candidate.originalDataUrl, 'original');
    let expected = baseline;
    for (const key of f.names) expected = composeReferencePixels(expected, generated.get(key), planReferenceCanvas(128, 64, meta, key));
    assert.deepEqual(f.pixels.get(candidate.dataUrl), expected);
    assert.deepEqual(baseline, f.pixels.get('original'), '原图不被修改');
    assert.equal((await f.service.acceptConsistency(candidate.candidateId)).ok, true);
    assert.deepEqual((await f.store.getSlotRecord(f.before.key)).consistencyPrompt.rounds.map((r) => r.characterKey), f.names);
});

test('gate:cg-consistency:强度归一自定义wire和失效门禁', async () => {
    const { normalizeAutoIllustrationSettings } = await import('../src/generated-images/illustration/auto-illustration-settings.js');
    for (const [input, expected] of [[undefined, 0.75], ['', 0.75], ['bad', 0.75], [-1, 0], [2, 1], ['0.4', 0.4]]) {
        assert.equal(normalizeAutoIllustrationSettings({ consistencyStrength: input }).consistencyStrength, expected);
    }
    const f = await consistencyAdapterFixture(2);
    try {
        f.igsSettings.autoIllustration = { consistencyStrength: 0.4 };
        const candidate = await f.service.run(f.target);
        assert.equal(candidate.ok, true, JSON.stringify(candidate));
        assert.ok(f.edits.every((r) => r.strength === 0.4));
        assert.ok(f.wires.every((r) => r.parameters.strength === 0.4));
        f.igsSettings.autoIllustration.consistencyStrength = 0.8;
        assert.equal((await f.service.accept(candidate.candidateId)).reason, 'stale-config');
        assert.deepEqual(await f.store.getSlotRecord(f.before.key), f.before);
    } finally { f.dispose(); }
    const changed = await consistencyFixture();
    const write = changed.backend.writeDbgenPrompt;
    changed.backend.writeDbgenPrompt = async (req) => {
        const result = await write(req);
        changed.igsSettings.consistencyStrength = 0.5;
        return result;
    };
    assert.equal((await changed.service.redrawConsistency(changed.query)).reason, 'stale-config');
    assert.equal(changed.calls.length, 0);
});

function consistencyFlatReply(request) {
    const output = JSON.parse(request.description.split('\n').at(-1));
    assert.equal(request.promptTask.slots.length, 1);
    assert.equal(output.slotId, request.promptTask.slots[0].slotId);
    assert.deepEqual(output.rows.map((r) => r.captionIndex), output.rows.map((_, i) => i));
    assert.deepEqual(output.rows.map((r) => r.token), request.promptTask.slots[0].tokens);
    assert.deepEqual(request.characterContext.map((c) => c.characterKey).sort(),
        [...new Set(output.rows.map((r) => r.characterKey))].sort());
    assert.doesNotMatch(request.description, /各份角色、景别、位置及工作尺寸/);
    const lines = [`slotid: ${output.slotId}`, 'prompt_mode: dna_template',
        `size: ${output.size.width}x${output.size.height}`, 'scene: People retain their original pose in a room.', 'scene_uc: blurry'];
    for (const row of output.rows) {
        const i = row.captionIndex, center = row.centers[0];
        if (row.kind === 'reference') assert.deepEqual(row.outfit, { name: '', description: '' });
        lines.push(`char: ${center.x},${center.y} | <<dna:${row.token}>> ${row.kind === 'reference'
            ? 'is visible from the shoulders up.' : `wears ${row.outfit.description}.`}`,
        `char_uc: <<dna_uc:${row.token}>>`, `meta_kind: ${i} | ${row.kind}`,
        `meta_key: ${i} | ${row.characterKey}`, `meta_token: ${i} | ${row.token}`,
        `meta_frame: ${i} | ${row.framing}`, `meta_outfit_name: ${i} | ${row.outfit.name}`,
        `meta_outfit_description: ${i} | ${row.outfit.description}`);
    }
    return { output, text: lines.join('\n') };
}

for (const duplicate of [false, true]) test(`gate:cg-consistency:单轮清单双端真实解析-${duplicate ? '重复拒收' : '同名参考分离'}`, async () => {
    const { createImageBackend } = await import('../src/generated-images/image-backend.js');
    const { parseTemplateCaptionSlots } = await import('../src/generated-images/illustration/template-caption-parser.js');
    const { buildPipeline } = await import('../../../nai-dbgen/tests/application/_fakes.js');
    const { Ok } = await import('../../../nai-dbgen/src/infra/result.js');
    const f = await consistencyFixture(), pipelines = [], requests = [];
    const adapter = createImageBackend({ getBridge: () => ({ imageApi: { mode: 'dbgen' } }),
        global: { NaiDbGen: { async generate() { assert.fail('写词不得发送图像请求'); },
            async generateSinglePrompt(req) {
            requests.push(req);
            const { text, output } = consistencyFlatReply(req);
            const reply = duplicate && output.slotId === 2
                ? text + '\nmeta_outfit_description: 0 | PRIVATE-DUPLICATE' : text;
            const igs = parseTemplateCaptionSlots(reply, req);
            assert.equal(igs.ok, !(duplicate && output.slotId === 2));
            const p = buildPipeline({ llmComplete: async () => Ok({ text: reply, json: null }) });
            pipelines.push(p);
            const result = await p.workbench.writePrompt({ mode: 'floor', skipRecall: true,
                naturalLanguage: req.description, characterContext: req.characterContext, promptTask: req.promptTask });
            if (result.ok) for (const field of ['caption', 'promptRecipe', 'characterMeta'])
                assert.deepEqual(result.value[field], igs.captions[0][field], field);
            return result;
        } } } });
    f.backend.writeDbgenPrompt = (req) => adapter.writeDbgenPrompt(req);

    try {
        const result = await f.service.redrawConsistency(f.query);
        assert.equal(requests.length, 3);
        assert.ok(pipelines.every((p) => p.naiCalls.length === 0 && p.llmCalls.length === 1));
        if (duplicate) {
            assert.equal(result.ok, false);
            assert.equal(result.reason, 'DNA_TEMPLATE_BINDING');
            assert.equal(result.diagnostics.field, 'meta_outfit_description');
            assert.equal(result.diagnostics.issue, 'duplicate');
            assert.equal(result.diagnostics.slotId, 2);
            assert.equal(result.diagnostics.captionIndex, 0);
            assert.equal(f.calls.length, 0);
            const error = f.reports.find((r) => r.level === 'error').message;
            assert.match(error, /prompt-parse.*meta_outfit_description.*duplicate.*slotid 2.*Char 0/);
            assert.doesNotMatch(error, /PRIVATE-DUPLICATE|coat-A|new-A/);
        } else {
            assert.equal(result.ok, true, JSON.stringify(result));
            assert.equal(f.calls.length, 2);
            for (const request of f.calls) {
                const named = request.promptRecipe.bindings.find((b) => b.kind === 'named');
                const ref = request.promptRecipe.bindings.find((b) => b.kind === 'reference');
                assert.equal(named.characterKey, ref.characterKey);
                assert.notEqual(named.captionIndex, ref.captionIndex);
                assert.notEqual(named.token, ref.token);
            }
            f.service.cancelConsistency(result.candidateId);
        }
        assert.deepEqual(await f.store.getSlotRecord(f.before.key), f.before);
    } finally { for (const p of pipelines) p.imageGen.dispose(); }
});
