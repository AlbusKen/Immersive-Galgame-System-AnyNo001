import test from 'node:test';
import assert from 'node:assert/strict';

import { createImageBackend } from '../src/generated-images/image-backend.js';
import { parseCaptionSlots } from '../src/generated-images/illustration/caption-writer.js';

function fakeBaibai({ supportsCharacters = false, fail = null } = {}) {
    const calls = [];
    return {
        calls,
        apiVersion: 1,
        getBackendStatus: () => ({ configured: true, supportsCharacters, reason: '' }),
        async generate(request) {
            calls.push(request);
            if (fail) throw Object.assign(new Error(fail), { code: 'backend_error' });
            return { dataUrl: 'data:image/png;base64,AAAA' };
        },
    };
}

function backendWith(api, { apiKey = '' } = {}) {
    const naiCalls = [];
    const backend = createImageBackend({
        global: { STBaiBaiImage: api },
        getBridge: () => ({ imageApi: { mode: 'baibai' }, autoIllustration: { nai: { apiKey } } }),
        nai: { async generate(slot) { naiCalls.push(slot); return { ok: true, dataUrl: 'data:image/png;base64,NAI' }; } },
    });
    return { backend, naiCalls };
}

const slot = { scene: 'cafe, afternoon light', sceneUc: 'lowres', chars: [{ name: '阿黛尔', tags: '1girl, silver hair' }] };

test('gate:baibai:joins-chars-and-skips-gallery', async () => {
    const api = fakeBaibai();
    const { backend } = backendWith(api);
    assert.equal(backend.describe().via, 'baibai');
    const result = await backend.generate(slot, { size: '1216x832' });
    assert.equal(result.ok, true);
    assert.equal(result.via, 'baibai');
    assert.deepEqual(api.calls[0], { prompt: 'cafe, afternoon light, 1girl, silver hair', negative: 'lowres', size: 'landscape', save: false });
});

test('gate:baibai:splits-characters-when-supported', async () => {
    const api = fakeBaibai({ supportsCharacters: true });
    const { backend } = backendWith(api);
    await backend.generate(slot, { size: '832x1216' });
    assert.equal(api.calls[0].prompt, 'cafe, afternoon light');
    assert.deepEqual(api.calls[0].characters, [{ name: '阿黛尔', tag: '1girl, silver hair' }]);
    assert.equal(api.calls[0].size, 'portrait');
});

test('gate:baibai:falls-back-to-nai-or-reports', async () => {
    const withKey = backendWith(fakeBaibai({ fail: 'boom' }), { apiKey: 'k' });
    const fallback = await withKey.backend.generate(slot, { apiKey: 'k' });
    assert.equal(fallback.via, 'nai');
    assert.equal(withKey.naiCalls.length, 1);

    const missing = backendWith(null);
    assert.equal(missing.backend.describe().ready.ok, false);
    const failed = await missing.backend.generate(slot, {});
    assert.equal(failed.ok, false);
    assert.match(failed.error, /未检测到柏宝绘/);
});

function llmBackend(mode, { llmSettings = {}, reply = '', api = fakeBaibai() } = {}) {
    const llmCalls = [];
    const naiCalls = [];
    const backend = createImageBackend({
        global: { STBaiBaiImage: api },
        getBridge: () => ({ imageApi: { mode }, autoIllustration: { llm: llmSettings, nai: { apiKey: 'k', size: '832x1216' } } }),
        nai: { async generate(slot, settings) { naiCalls.push({ slot, settings }); return { ok: true, dataUrl: 'data:image/png;base64,NAI' }; } },
        llm: { async request(messages) { llmCalls.push(messages); return reply; } },
    });
    return { backend, llmCalls, naiCalls, api };
}

test('gate:caption-writer:parses-numbered-slots', () => {
    const parsed = parseCaptionSlots('```\n#1\nscene: 1girl, cowboy shot\nchar: smile\nuc: lowres\n#2\nscene: 1girl\nchar: angry\n```');
    assert.equal(parsed.ok, true);
    assert.deepEqual(parsed.captions.map((item) => item.slotId), [1, 2]);
    assert.equal(parsed.captions[0].caption.v4_prompt.caption.base_caption, '1girl, cowboy shot');
    assert.equal(parsed.captions[0].caption.v4_prompt.caption.char_captions[0].char_caption, 'smile');
    assert.equal(parsed.captions[0].caption.v4_negative_prompt.caption.base_caption, 'lowres');
    const clothes = parseCaptionSlots('scene: school uniform, pleated skirt\nchar:');
    assert.deepEqual(clothes.captions[0].caption.v4_prompt.caption.char_captions, []);
});

test('gate:caption-writer:non-dbgen-writes-with-llm-and-paints-with-source', async () => {
    const { backend, llmCalls, api } = llmBackend('baibai', { reply: '#1\nscene: 1girl, cowboy shot\nchar: silver hair, smile' });
    const written = await backend.writeDbgenPrompt({ description: '为角色「阿黛尔」写 1 份立绘表情差分。' });
    assert.equal(written.ok, true);
    assert.equal(llmCalls.length, 1);
    assert.match(llmCalls[0].user, /阿黛尔/);
    const painted = await backend.generateDbgenCaption({ caption: written.caption, size: '832x1216', userPrompts: { positive: 'grey background', negative: 'bad hands' } });
    assert.equal(painted.ok, true);
    assert.equal(painted.via, 'baibai');
    assert.match(api.calls[0].prompt, /grey background/);
    assert.match(api.calls[0].prompt, /silver hair, smile/);
    assert.match(api.calls[0].negative, /bad hands/);
    assert.equal(api.calls[0].size, 'portrait');
});

test('gate:caption-writer:reminds-when-llm-not-connected', async () => {
    const { backend, llmCalls } = llmBackend('nai', { llmSettings: { source: 'openai', endpoint: '', model: '' } });
    const written = await backend.writeDbgenPrompt({ description: '画角色「阿黛尔」的立绘。' });
    assert.equal(written.ok, false);
    assert.match(written.error, /还没接副 LLM/);
    assert.match(written.error, /生图 → 副 LLM/);
    assert.equal(llmCalls.length, 0);
});

test('gate:caption-writer:nai-source-paints-caption-as-slot', async () => {
    const { backend, naiCalls } = llmBackend('nai');
    const caption = parseCaptionSlots('scene: 1girl\nchar: smile\nuc: blurry').captions[0].caption;
    const painted = await backend.generateDbgenCaption({ caption, size: '1024x1024', transparent: true });
    assert.equal(painted.ok, true);
    assert.equal(naiCalls[0].settings.size, '1024x1024');
    assert.equal(naiCalls[0].slot.transparent, true);
    assert.deepEqual(naiCalls[0].slot.chars, [{ tags: 'smile', uc: '', x: 0.5, y: 0.5 }]);
    assert.equal(naiCalls[0].slot.sceneUc, 'blurry');
});

function floorBackend(api, { mes = '', autoTag = false, sleep = async () => {} } = {}) {
    const chat = [];
    chat[5] = { mes };
    const context = { chat, extensionSettings: { baibai_image: { enabled: true, autoTag: { enabled: autoTag } } } };
    const naiCalls = [];
    const backend = createImageBackend({
        global: { STBaiBaiImage: api, SillyTavern: { getContext: () => context } },
        getBridge: () => ({ imageApi: { mode: 'baibai' }, autoIllustration: { nai: {} } }),
        nai: { async generate(s) { naiCalls.push(s); return { ok: true, dataUrl: 'data:image/png;base64,NAI' }; } },
        floorPromptWait: { timeoutMs: 30, intervalMs: 10, sleep: () => sleep(context) },
    });
    return { backend, context, naiCalls };
}

test('gate:baibai:story-cg-uses-baibai-floor-tags', async () => {
    const api = fakeBaibai({ supportsCharacters: true });
    const mes = '正文<bbi_image>1girl, cafe</bbi_image>中间<bbi_image>2girls, rooftop, silver hair<nl>Two girls on a rooftop.</nl></bbi_image>';
    const { backend } = floorBackend(api, { mes });
    await backend.generate(slot, { size: '1216x832' }, { messageId: 5, slot: 2 });
    assert.equal(api.calls[0].prompt, '2girls, rooftop, silver hair');
    assert.equal(api.calls[0].nl, 'Two girls on a rooftop.');
    assert.equal(api.calls[0].characters, undefined);
    assert.equal(api.calls[0].negative, 'lowres');
});

test('gate:baibai:falls-back-to-igs-tags-without-floor-tags', async () => {
    const api = fakeBaibai();
    const { backend } = floorBackend(api, { mes: '正文<bbi_image>1girl, cafe</bbi_image>' });
    await backend.generate(slot, { size: '1216x832' }, { messageId: 5, slot: 2 });
    assert.equal(api.calls[0].prompt, 'cafe, afternoon light, 1girl, silver hair');
    await backend.generate(slot, { size: '1216x832' });
    assert.equal(api.calls[1].prompt, 'cafe, afternoon light, 1girl, silver hair');
});

test('gate:baibai:waits-for-baibai-auto-tagging', async () => {
    const api = fakeBaibai();
    let naps = 0;
    const { backend } = floorBackend(api, { mes: '正文', autoTag: true, sleep: async (context) => { naps += 1; if (naps === 2) context.chat[5].mes += '<bbi_image>1girl, written later</bbi_image>'; } });
    await backend.generate(slot, { size: '1216x832' }, { messageId: 5, slot: 1 });
    assert.equal(api.calls[0].prompt, '1girl, written later');
});

function chatu8Backend({ mes = '', settings = {}, sleep = async () => {} } = {}) {
    const chat = [];
    chat[3] = { mes };
    const context = { chat, extensionSettings: { 'st-chatu8': settings } };
    const prompts = [];
    const backend = createImageBackend({
        global: { SillyTavern: { getContext: () => context } },
        getBridge: () => ({ imageApi: { mode: 'extension' }, autoIllustration: { nai: {} } }),
        nai: { async generate() { return { ok: true, dataUrl: 'data:image/png;base64,NAI' }; } },
        chatu8: { findHost: () => ({ win: {}, eventSource: {} }), async request(host, prompt) { prompts.push(prompt); return { ok: true, imageData: 'data:image/png;base64,C8' }; } },
        floorPromptWait: { timeoutMs: 30, intervalMs: 10, sleep: () => sleep(context) },
    });
    return { backend, prompts };
}

test('gate:chatu8:story-cg-uses-chatu8-floor-tags', async () => {
    const mes = '正文\n\n<image>image###1girl, 阿黛尔, cafe###</image>\n后文\n\n<image>image###2girls, rooftop###</image>';
    const { backend, prompts } = chatu8Backend({ mes });
    await backend.generate(slot, { size: '1216x832' }, { messageId: 3, slot: 2 });
    assert.equal(prompts[0], '2girls, rooftop');
    await backend.generate(slot, { size: '1216x832' }, { messageId: 3, slot: 3 });
    assert.equal(prompts[1], 'cafe, afternoon light, 1girl, silver hair');
});

test('gate:chatu8:waits-only-when-it-writes-back', async () => {
    let naps = 0;
    const settings = { scriptEnabled: 'true', autoLLMImageGen: 'true', insertOriginalText: 'true', startTag: 'pic<<', endTag: '>>' };
    const { backend, prompts } = chatu8Backend({ mes: '短正文', settings, sleep: async (context) => { naps += 1; if (naps === 2) context.chat[3].mes += '<image>pic<<1girl, later>></image>'; } });
    await backend.generate(slot, { size: '1216x832' }, { messageId: 3, slot: 1 });
    assert.equal(prompts[0], '1girl, later');
    const off = chatu8Backend({ mes: '短正文', settings: { ...settings, insertOriginalText: 'false' }, sleep: async () => { throw new Error('不该等'); } });
    await off.backend.generate(slot, { size: '1216x832' }, { messageId: 3, slot: 1 });
    assert.equal(off.prompts[0], 'cafe, afternoon light, 1girl, silver hair');
});

test('gate:image-backend:kind-models-override-nai-and-dbgen', async () => {
    const naiCalls = [];
    const dbgenCalls = [];
    let mode = 'nai';
    const imageApi = () => ({ mode, cgModel: 'nai-diffusion-5-full', spriteModel: 'nai-diffusion-4-full', backgroundModel: '', itemModel: 'nai-diffusion-4-5-curated' });
    const backend = createImageBackend({
        global: { NaiDbGen: { async generate(req) { dbgenCalls.push(req); return { ok: true, value: [{ blob: 'data:image/png;base64,DB' }] }; } } },
        getBridge: () => ({ imageApi: imageApi(), autoIllustration: { nai: { apiKey: 'k', model: 'nai-diffusion-4-5-full', size: '832x1216' } } }),
        nai: { async generate(slot, settings) { naiCalls.push(settings); return { ok: true, dataUrl: 'data:image/png;base64,NAI' }; } },
    });
    await backend.generate({ scene: '1girl' }, { model: 'nai-diffusion-4-5-full' }, { imageKind: 'sprite' });
    await backend.generate({ scene: 'room' }, { model: 'nai-diffusion-4-5-full' }, { imageKind: 'background' });
    await backend.generate({ scene: 'apple' }, { model: 'nai-diffusion-4-5-full' }, { imageKind: 'item' });
    await backend.generate({ scene: 'cg' }, { model: 'nai-diffusion-4-5-full' }, {});
    await backend.generate({ scene: 'cg' }, { model: 'nai-diffusion-4-5-full' }, { imageKind: 'cg' });
    assert.deepEqual(naiCalls.map((s) => s.model), ['nai-diffusion-4-full', 'nai-diffusion-4-5-full', 'nai-diffusion-4-5-curated', 'nai-diffusion-4-5-full', 'nai-diffusion-5-full']);

    mode = 'dbgen';
    const caption = { v4_prompt: { caption: { base_caption: '1girl', char_captions: [] } }, v4_negative_prompt: { caption: { base_caption: '', char_captions: [] } } };
    await backend.generateDbgenCaption({ caption, imageKind: 'sprite' });
    await backend.generateDbgenCaption({ caption, imageKind: 'background' });
    await backend.generateDbgenCaption({ caption, imageKind: 'cg' });
    assert.equal(dbgenCalls[0].params.model, 'nai-diffusion-4-full');
    assert.equal(dbgenCalls[1].params, undefined);
    assert.equal(dbgenCalls[2].params.model, 'nai-diffusion-5-full');
});

test('gate:image-backend:dbgen-refuses-empty-caption', async () => {
    let paints = 0;
    const backend = createImageBackend({
        global: {
            NaiDbGen: {
                async generate() { paints += 1; return { ok: true, value: [{ blob: 'data:image/png;base64,DB' }] }; },
            },
        },
        getBridge: () => ({ imageApi: { mode: 'dbgen' } }),
    });
    const empty = {
        v4_prompt: { caption: { base_caption: '', char_captions: [] } },
        v4_negative_prompt: { caption: { base_caption: 'lowres', char_captions: [] } },
    };
    const result = await backend.generateDbgenCaption({
        caption: empty,
        userPrompts: { positive: '1girl, solo', negative: 'lowres' },
    });
    assert.equal(result.ok, false);
    assert.match(result.error, /不是生图提示词/);
    assert.equal(paints, 0);
});


test('gate:dna-template:dbgen-workbench-to-igs-preserves-template-and-candidate', async () => {
    const { buildPipeline } = await import('../../../nai-dbgen/tests/application/_fakes.js');
    const { Ok } = await import('../../../nai-dbgen/src/infra/result.js');
    const promptTask = { version: 1, mode: 'dna_template', purpose: 'sprite',
        characters: [{ characterKey: 'Alice', token: 'rA7', framing: 'half_body' }] };
    const characterContext = [{ characterKey: 'Alice', dna: {} }];
    const reply = ['slotid: 6', 'prompt_mode: dna_template', 'scene: One woman in a half-body composition.',
        'char: 0.3,0.5 | <<dna:rA7>> wears a blue coat and waves toward Bob.',
        'char_uc: <<dna_uc:rA7>>, closed eyes', 'meta_kind: 0 | named', 'meta_key: 0 | Alice',
        'meta_token: 0 | rA7', 'meta_frame: 0 | half_body', 'meta_outfit_name: 0 | Coat',
        'meta_outfit_description: 0 | A blue coat.',
        'meta_dna_full_body: 0 | Alice, a tall adult woman with silver hair, blue eyes and a silver ring on her left hand,',
        'meta_dna_half_body: 0 | Alice, an adult woman with silver hair, blue eyes and a silver ring on her left hand,',
        'meta_dna_portrait: 0 | Alice, an adult woman with silver hair and blue eyes,',
        'meta_dna_partial: 0 | Alice\'s pale left hand with a silver ring,'].join('\n');
    const p = buildPipeline({ llmComplete: async () => Ok({ text: reply, json: null }) });
    const requests = [];
    const api = { async generate() { assert.fail('写词交接不得调用生图'); },
        async generateSinglePrompt(req) {
        requests.push(req);
        return p.workbench.writePrompt({ mode: 'floor', skipRecall: true,
            naturalLanguage: req.description, characterContext: req.characterContext, promptTask: req.promptTask });
    } };
    const backend = createImageBackend({ global: { NaiDbGen: api }, getBridge: () => ({ imageApi: { mode: 'dbgen' } }) });
    const written = await backend.writeDbgenPrompt({ description: '画 Alice 的半身立绘', characterContext, promptTask });
    assert.equal(written.ok, true, written.error);
    assert.deepEqual(requests[0].promptTask, promptTask);
    assert.equal(written.captions[0].slotId, 6);
    assert.deepEqual(written.promptRecipe.caption, written.caption);
    assert.equal(written.promptRecipe.bindings[0].characterKey, 'Alice');
    assert.match(written.dnaCandidates.characters[0].views.partial.subject, /left hand/);
    assert.equal(written.caption.v4_prompt.caption.char_captions[0].centers[0].x, 0.3);
    assert.match(written.caption.v4_prompt.caption.char_captions[0].char_caption, /toward Bob/);
    assert.match(p.llmCalls[0].messages.at(-1).content, /rA7/);
    assert.match(p.llmCalls[0].messages.at(-1).content, /meta_dna_partial/);
    assert.equal(p.llmCalls.length, 1);
    assert.equal(p.naiCalls.length, 0);
    const rejected = await backend.writeDbgenPrompt({ description: '画 Alice 的 CG', characterContext,
        promptTask: { ...promptTask, purpose: 'cg' } });
    assert.equal(rejected.ok, false);
    assert.equal(p.naiCalls.length, 0);
});


function dnaTemplateFixture() {
    const caption = { v4_prompt: { caption: { base_caption: 'Alice and Alicia meet in a corridor.', char_captions: [
        { char_caption: '<<dna:rA7>> wears a blue coat and reaches toward Alicia.', centers: [{ x: 0.23, y: 0.51 }] },
        { char_caption: '<<dna:rB9>> wears a red coat and looks toward Alice.', centers: [{ x: 0.77, y: 0.49 }] },
    ] } }, v4_negative_prompt: { caption: { base_caption: 'closed eyes', char_captions: [
        { char_caption: '<<dna_uc:rA7>>, blurry hands' }, { char_caption: '<<dna_uc:rB9>>' },
    ] } } };
    const bindings = [{ kind: 'named', characterKey: 'Alice', captionIndex: 0, token: 'rA7', framing: 'half_body' },
        { kind: 'named', characterKey: 'Alicia', captionIndex: 1, token: 'rB9', framing: 'portrait' }];
    const characterContext = [
        { characterKey: 'Alice', dna: { version: 2, views: { half_body: { subject: 'Alice, with 1.2::silver hair:: and a $5 hair clip,', negative: 'glasses' } } } },
        { characterKey: 'Alicia', dna: { version: 2, views: { portrait: { subject: 'Alicia, with black hair and green eyes,', negative: '' } } } },
    ];
    return { caption, promptRecipe: { version: 1, mode: 'dna_template', caption: structuredClone(caption), bindings },
        characterContext, characterMeta: { version: 1, characters: bindings.map((b) => ({ characterKey: b.characterKey,
            captionIndex: b.captionIndex, identityAnchor: '', signatureDetails: '', outfit: { name: '', description: '' },
            centers: structuredClone(caption.v4_prompt.caption.char_captions[b.captionIndex].centers), positionExplicit: true })) } };
}

test('gate:dna-template:自身展开保真且缺景别、重复或跨角色令牌失败关闭', async () => {
    const { prepareCharacterCaption } = await import('../src/generated-images/character-caption.js');
    const fixture = dnaTemplateFixture(), before = structuredClone(fixture);
    const result = prepareCharacterCaption(fixture);
    assert.equal(result.ok, true, result.error);
    assert.equal(result.caption.v4_prompt.caption.base_caption, fixture.caption.v4_prompt.caption.base_caption);
    assert.equal(result.caption.v4_prompt.caption.char_captions[0].char_caption,
        'Alice, with 1.2::silver hair:: and a $5 hair clip, wears a blue coat and reaches toward Alicia.');
    assert.equal(result.caption.v4_negative_prompt.caption.char_captions[1].char_caption, '');
    assert.deepEqual(result.caption.v4_prompt.caption.char_captions[0].centers, [{ x: 0.23, y: 0.51 }]);
    assert.deepEqual(fixture, before);
    assert.equal(Object.isFrozen(result.dnaSnapshot.characters[0].profile), true);
    const missing = dnaTemplateFixture(); missing.characterContext[0].dna.views = { portrait: { subject: 'Alice,' } };
    assert.equal(prepareCharacterCaption(missing).reason, 'DNA_VIEW_MISSING');
    const absent = dnaTemplateFixture(); absent.characterContext[0].dna = {};
    assert.equal(prepareCharacterCaption(absent).reason, 'DNA_MISSING');
    for (const text of ['<<dna:rB9>> waves.', '<<dna:rA7>> <<dna:rA7>> waves.', '<<dna:unknown>> waves.']) {
        const invalid = dnaTemplateFixture(); invalid.caption.v4_prompt.caption.char_captions[0].char_caption = text;
        assert.equal(prepareCharacterCaption(invalid).ok, false);
    }
    const recursive = dnaTemplateFixture(); recursive.characterContext[0].dna.views.half_body.subject = '<<dna:rB9>>';
    assert.equal(prepareCharacterCaption(recursive).ok, false);
    assert.equal(prepareCharacterCaption({ caption: fixture.caption, captionMode: 'final' }).reason, 'DNA_TEMPLATE_UNRESOLVED');
    const promptTask = { version: 1, mode: 'dna_template', purpose: 'cg',
        characters: fixture.promptRecipe.bindings.map(({ characterKey, token, framing }) => ({ characterKey, token, framing })) };
    assert.equal(prepareCharacterCaption({ ...fixture, promptTask }).ok, true);
    const finalCaption = result.caption;
    assert.equal(prepareCharacterCaption({ caption: finalCaption, promptTask }).reason, 'PROMPT_MODE_CONFLICT');
    assert.equal(prepareCharacterCaption({ ...fixture, caption: finalCaption, captionMode: 'final' }).reason, 'PROMPT_MODE_CONFLICT');
    assert.equal(prepareCharacterCaption({ ...fixture, promptTask: { ...promptTask, purpose: 'unknown' } }).reason, 'PROMPT_MODE_CONFLICT');
    assert.equal(prepareCharacterCaption({ ...fixture, dnaCandidates: { version: 1, characters: [] } }).reason, 'PROMPT_MODE_CONFLICT');
    const duplicate = dnaTemplateFixture(); duplicate.characterContext.push(duplicate.characterContext[0]);
    assert.equal(prepareCharacterCaption(duplicate).reason, 'DNA_TEMPLATE_BINDING');
    const reference = dnaTemplateFixture(); reference.promptRecipe.bindings[1].kind = 'reference';
    reference.characterMeta.characters.pop();
    assert.equal(prepareCharacterCaption(reference).reason, 'PROMPT_MODE_CONFLICT');
    assert.equal(prepareCharacterCaption({ caption: finalCaption, captionMode: 'final' }).ok, true);
    assert.deepEqual(prepareCharacterCaption({ caption: finalCaption }), { ok: true, caption: finalCaption });
});

test('gate:dna-template:普通CG当次身份与严格任务边界', async () => {
    const { prepareCharacterCaption, readCaptionIdentity } = await import('../src/generated-images/character-caption.js');
    const { promptProvenance } = await import('../src/generated-images/generation-prompt.js');
    const fixture = dnaTemplateFixture();
    fixture.promptTask = { version: 1, mode: 'dna_template', purpose: 'cg',
        characters: fixture.promptRecipe.bindings.map(({ characterKey, token }) => ({ characterKey, token })) };
    fixture.characterContext[0].dna = {};
    fixture.characterMeta.characters[0].identityAnchor = 'Alice, an adult woman with silver hair and a star hair clip,';
    fixture.characterMeta.characters[0].signatureDetails = 'star hair clip';
    const before = structuredClone(fixture), result = prepareCharacterCaption(fixture);
    assert.equal(result.ok, true, result.error);
    assert.equal(result.dnaSnapshot.characters[0].source, 'scene');
    assert.equal(result.dnaSnapshot.characters[0].dnaVersion, 0);
    assert.deepEqual(promptProvenance(result).dnaSnapshot, result.dnaSnapshot);
    assert.deepEqual(fixture, before);
    for (const purpose of ['derived', 'consistency']) {
        assert.equal(prepareCharacterCaption({ ...fixture, promptTask: { ...fixture.promptTask, purpose } }).reason, 'DNA_MISSING');
    }
    const metadata = fixture.characterMeta.characters[0];
    assert.equal(readCaptionIdentity({ identity: 'Alice,' }, 'portrait', 'cg', metadata).source, 'scene');
    for (const dna of [{ version: 9 }, { version: 2, views: { portrait: { subject: '<<dna:bad>>' } } }]) {
        assert.equal(readCaptionIdentity(dna, 'portrait', 'cg', metadata).reason, 'DNA_VIEW_INVALID');
    }
    assert.equal(readCaptionIdentity({}, 'portrait', 'cg', { ...metadata, identityAnchor: '<<dna:other>>' }).reason, 'DNA_TEMPLATE_UNRESOLVED');
    const wrong = structuredClone(fixture);
    wrong.promptRecipe.bindings[0].characterKey = 'Alicia';
    assert.equal(prepareCharacterCaption(wrong).ok, false);
    const recursive = structuredClone(fixture);
    recursive.characterMeta.characters[0].identityAnchor = '<<dna:rB9>>';
    assert.equal(prepareCharacterCaption(recursive).reason, 'DNA_TEMPLATE_UNRESOLVED');
    assert.throws(() => promptProvenance({ dnaSnapshot: { version: 1,
        characters: [{ ...result.dnaSnapshot.characters[0], source: 'scene', dnaVersion: 2 }] } }), /PROMPT_PROVENANCE_INVALID/);
});


test('gate:dna-template:内置 NAI 最终 wire 仅展开加画师且快照同源', async () => {
    const { createNaiOfficialClient } = await import('../src/generated-images/nai-official-client.js');
    const fixture = dnaTemplateFixture(), wires = [];
    const nai = createNaiOfficialClient({ fetch: async (_url, init) => {
        wires.push(JSON.parse(init.body));
        return new Response(JSON.stringify({ images: [{ image: 'data:image/png;base64,AAAA' }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    } });
    const bridge = { imageApi: { mode: 'nai' }, autoIllustration: { nai: {
        apiKey: 'fake-key', model: 'nai-diffusion-5-full', artistPrefix: 'artist:global', negativePrompt: 'OLD-AUTO-UC',
    } } };
    const before = structuredClone(bridge);
    const backend = createImageBackend({ getBridge: () => bridge, nai });
    for (const artist of [undefined, null, { positivePrompt: 'artist:local', negativePrompt: 'artist-uc' }]) {
        const result = await backend.generateDbgenCaption({ ...fixture, ...(artist !== undefined && { artist }) });
        assert.equal(result.ok, true, result.error);
        const wire = wires.at(-1), prefix = artist === undefined ? 'artist:global' : artist?.positivePrompt;
        assert.equal(wire.input, (prefix ? prefix + ', ' : '') + fixture.caption.v4_prompt.caption.base_caption);
        assert.equal(wire.parameters.negative_prompt, (artist?.negativePrompt ? artist.negativePrompt + ', ' : '') + 'closed eyes');
        assert.deepEqual(result.sentPrompt.caption.v4_prompt.caption, wire.parameters.v4_prompt.caption);
        assert.deepEqual(result.sentPrompt.caption.v4_negative_prompt.caption, wire.parameters.v4_negative_prompt.caption);
        assert.deepEqual(wire.parameters.v4_prompt.caption.char_captions[0].centers, [{ x: 0.23, y: 0.51 }]);
        assert.equal(wire.parameters.qualityToggle, false);
        assert.equal(wire.parameters.tag_hint_uc_preset, false);
        assert.equal(JSON.stringify(result.sentPrompt).includes('fake-key'), false);
        assert.equal(JSON.stringify(wire).includes('<<dna:'), false);
        assert.equal(result.prompt.caption.v4_prompt.caption.base_caption, fixture.caption.v4_prompt.caption.base_caption);
    }
    const count = wires.length;
    const failed = await backend.generateDbgenCaption({ ...fixture, userPrompts: { positive: 'SHOULD-NOT-APPEND' } });
    assert.equal(failed.reason, 'PROMPT_MODE_CONFLICT');
    assert.equal(wires.length, count);
    assert.deepEqual(bridge, before);
});

test('gate:dna-template:内置局部重绘定稿 wire 和取消与快照同源', async () => {
    const { createNaiOfficialClient } = await import('../src/generated-images/nai-official-client.js');
    const wires = [];
    const nai = createNaiOfficialClient({ fetch: async (_url, init) => {
        wires.push(JSON.parse(init.body));
        return new Response(JSON.stringify({ image: 'data:image/png;base64,AAAA' }),
            { status: 200, headers: { 'Content-Type': 'application/json' } });
    } });
    const backend = createImageBackend({ nai, getBridge: () => ({ imageApi: { mode: 'nai' },
        autoIllustration: { nai: { apiKey: 'fake-key', model: 'nai-diffusion-4-5-full', artistPrefix: 'artist:global' } } }) });
    const request = { ...dnaTemplateFixture(), sourceDataUrl: 'data:image/png;base64,SOURCE',
        maskDataUrl: 'data:image/png;base64,MASK', width: 64, height: 128 };
    const before = structuredClone(request);
    for (const artist of [undefined, null, { positivePrompt: 'artist:local', negativePrompt: 'local-uc' }]) {
        const result = await backend.edit({ ...request, ...(artist !== undefined && { artist }) });
        assert.equal(result.ok, true, result.error);
        const wire = wires.at(-1);
        const prefix = artist === undefined ? 'artist:global' : artist?.positivePrompt;
        assert.equal(wire.input, (prefix ? prefix + ', ' : '') + request.caption.v4_prompt.caption.base_caption);
        assert.equal(wire.parameters.negative_prompt, (artist?.negativePrompt ? artist.negativePrompt + ', ' : '') + 'closed eyes');
        assert.deepEqual(result.sentPrompt.caption.v4_prompt.caption, wire.parameters.v4_prompt.caption);
        assert.deepEqual(result.sentPrompt.caption.v4_negative_prompt.caption, wire.parameters.v4_negative_prompt.caption);
        assert.equal(result.sentPrompt.action, 'infill');
        assert.equal(result.sentPrompt.model, wire.model);
        assert.equal(wire.parameters.image, 'SOURCE');
        assert.equal(wire.parameters.mask, 'MASK');
        assert.equal(wire.parameters.qualityToggle, false);
        assert.equal(wire.parameters.ucPreset, 4);
        assert.equal(JSON.stringify(result.sentPrompt).includes('SOURCE'), false);
    }
    const count = wires.length;
    for (const extra of [{ signal: AbortSignal.abort() }, { shouldStart: () => false }, { promptRecipe: undefined, promptTask: { version: 1 } }]) {
        assert.equal((await backend.edit({ ...request, ...extra })).ok, false);
    }
    assert.equal(wires.length, count);
    assert.deepEqual(request, before);
});

test('gate:dna-template:IGS 到 DBGen 直连、阅读器和局部重绘使用实际 wire', async () => {
    const { buildPipeline } = await import('../../../nai-dbgen/tests/application/_fakes.js');
    const { Ok } = await import('../../../nai-dbgen/src/infra/result.js');
    const { createImageGenService } = await import('../../../nai-dbgen/src/application/image-gen.service.js');
    const { createNaiGateway } = await import('../../../nai-dbgen/src/adapters/nai/nai.gateway.js');
    const { createDirectTransport } = await import('../../../nai-dbgen/src/adapters/nai/transport/direct.js');
    const { defaultPluginSettings } = await import('../../../nai-dbgen/src/domain/model/plugin-settings.js');
    const fixture = dnaTemplateFixture(), wires = [], writes = [], paints = [];
    const promptTask = { version: 1, mode: 'dna_template', purpose: 'cg', characters:
        fixture.promptRecipe.bindings.map(({ characterKey, token, framing }) => ({ characterKey, token, framing })) };
    const reply = ['slotid: 6', 'prompt_mode: dna_template', 'scene: ' + fixture.caption.v4_prompt.caption.base_caption,
        'scene_uc: closed eyes', ...fixture.promptRecipe.bindings.flatMap((b) => [
            `char: ${fixture.caption.v4_prompt.caption.char_captions[b.captionIndex].centers[0].x},0.5 | ${fixture.caption.v4_prompt.caption.char_captions[b.captionIndex].char_caption}`,
            `char_uc: ${fixture.caption.v4_negative_prompt.caption.char_captions[b.captionIndex].char_caption}`,
            `meta_kind: ${b.captionIndex} | named`, `meta_key: ${b.captionIndex} | ${b.characterKey}`,
            `meta_token: ${b.captionIndex} | ${b.token}`, `meta_frame: ${b.captionIndex} | ${b.framing}`,
            `meta_outfit_name: ${b.captionIndex} | Coat`, `meta_outfit_description: ${b.captionIndex} | A coat.`,
        ])].join('\n');
    const p = buildPipeline({ llmComplete: async () => Ok({ text: reply, json: null }) });
    const settings = { ...defaultPluginSettings(), activeNaiConfigId: 'fake' };
    settings.naiParams = { ...settings.naiParams, model: 'nai-diffusion-5-full', width: 64, height: 128 };
    const gateway = createNaiGateway({ transports: { direct: createDirectTransport({ fetch: async (_url, init) => {
        wires.push(JSON.parse(init.body));
        return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
    } }) }, decoders: { 'json-base64': { decode: async () => Ok([{ blob: new Blob(['fake'], { type: 'image/png' }), mimeType: 'image/png' }]) } } });

    settings.activeArtistId = 'artist';
    const inherited = { positivePrompt: 'artist:global', negativePrompt: 'global-uc' };
    const service = createImageGenService({ imageGenPort: gateway, loadSettings: () => settings,
        naiConfigRepo: { get: async () => Ok({ id: 'fake', baseUrl: 'https://example.invalid', apiKey: 'fake-key', transport: 'direct', decoder: 'json' }) },
        artistRepo: { get: async () => Ok(inherited) }, newTraceId: () => 'igs-wire-test' });
    const api = { getPromptCapabilities: () => ({ finalCaption: 1, promptSnapshot: 1 }),
        describeInfill: () => service.describeInfill(),
        async generate(req) { paints.push(req); return service.generate(req); },
        async generateSinglePrompt(req) {
            writes.push(req);
            return p.workbench.writePrompt({ mode: 'floor', skipRecall: true,
                naturalLanguage: req.description, characterContext: req.characterContext, promptTask: req.promptTask });
        } };
    const backend = createImageBackend({ global: { NaiDbGen: api }, getBridge: () => ({ imageApi: { mode: 'dbgen' } }) });
    const checkWire = (result, action) => {
       assert.equal(result.ok, true, result.error);
        const wire = wires.at(-1);
        assert.equal(wire.action, action);
        assert.equal(wire.input, 'artist:global, ' + fixture.caption.v4_prompt.caption.base_caption);
        assert.equal(wire.parameters.negative_prompt, 'global-uc, closed eyes');
        assert.deepEqual(result.sentPrompt.caption.v4_prompt.caption, wire.parameters.v4_prompt.caption);
        assert.deepEqual(result.sentPrompt.caption.v4_negative_prompt.caption, wire.parameters.v4_negative_prompt.caption);
        assert.equal(result.sentPrompt.model, wire.model);
        assert.equal(result.sentPrompt.action, action);
        assert.equal(JSON.stringify(wire).includes('<<dna'), false);
        assert.equal(JSON.stringify(result.sentPrompt).includes('fake-key'), false);
        assert.equal(paints.at(-1).replaceCharacterKeywords, false);
        assert.equal(paints.at(-1).captionMode, 'final');
        assert.equal(paints.at(-1).capturePrompt, true);
    };
    try {
        const direct = await backend.generate({}, {}, { description: '两位朋友在走廊见面', skipRecall: true,
            promptTask, characterContext: fixture.characterContext });
        checkWire(direct, 'generate');
        assert.deepEqual(writes[0].promptTask, promptTask);
        assert.equal(writes[0].skipRecall, true);
        assert.equal(p.llmCalls.length, 1);
        assert.equal(writes.length, 1);
        assert.equal(wires.length, 1);
        checkWire(await backend.generate({ ...fixture }, {}), 'generate');
        assert.equal(writes.length, 1);

        const reader = await backend.generateForReader(fixture, { imageApi: { mode: 'dbgen' } });
        checkWire(reader, 'generate');
        assert.match(reader.url, /^data:image\/png;base64,/);
        assert.equal(reader.providerId, 'vn.provider.dbgen');
        const bytes = new Uint8Array(36);
        bytes.set([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82]);
        const header = new DataView(bytes.buffer);
        header.setUint32(16, 64); header.setUint32(20, 128);
        const png = 'data:image/png;base64,' + btoa(String.fromCharCode(...bytes));
        checkWire(await backend.edit({ ...fixture, sourceDataUrl: png, maskDataUrl: png, width: 64, height: 128 }), 'infill');
        const count = wires.length;
        const missing = dnaTemplateFixture(); missing.characterContext[0].dna = {};
        assert.equal((await backend.generateDbgenCaption(missing)).reason, 'DNA_MISSING');
        assert.equal((await backend.generate({}, {}, { promptRecipe: fixture.promptRecipe })).reason, 'PROMPT_MODE_CONFLICT');
        assert.equal((await backend.generateForReader(fixture, { imageApi: { mode: 'nai' } })).reason, 'PROMPT_MODE_CONFLICT');
        assert.equal((await backend.generateDbgenCaption({ caption: direct.caption, promptTask })).reason, 'PROMPT_MODE_CONFLICT');
        assert.equal(wires.length, count);
        assert.equal(writes.length, 1);
        assert.equal(p.llmCalls.length, 1);
        for (const mode of ['baibai', 'extension']) {
            const isolated = createImageBackend({ global: { NaiDbGen: api }, getBridge: () => ({ imageApi: { mode } }),
                nai: { async generate() { assert.fail('其他来源不能降级至内置 NAI'); } } });
            assert.equal((await isolated.generate(fixture, {})).reason, 'PROMPT_MODE_CONFLICT');
            assert.equal((await isolated.generateDbgenCaption(fixture)).reason, 'PROMPT_MODE_CONFLICT');
            assert.equal((await isolated.generateDbgenCaption({ caption: direct.caption, promptTask })).reason, 'PROMPT_MODE_CONFLICT');
        }
        assert.equal(wires.length, count);
    } finally { service.dispose(); }
});

function templateWritingFixture(candidate = false) {
    const subject = 'Alice, an adult woman with 1.2::silver hair:: and blue eyes,';
    const views = Object.fromEntries(['full_body', 'half_body', 'portrait', 'partial']
        .map((frame) => [frame, { subject, negative: '' }]));
    const promptTask = { version: 1, mode: 'dna_template', purpose: candidate ? 'sprite' : 'cg',
        characters: [{ characterKey: 'Alice', token: 'rA7', framing: 'half_body' }] };
    const characterContext = [{ characterKey: 'Alice', dna: candidate ? {} : { version: 2, views } }];
    const reply = ['slotid: 6', 'prompt_mode: dna_template', 'size: 832x1216',
        'scene: One woman stands against a transparent background in soft light. masterpiece',
        'scene_uc: blurry', 'char: 0.23,0.51 | <<dna:rA7>> wears a blue coat and waves toward Bob.',
        'char_uc: <<dna_uc:rA7>>, closed eyes', 'meta_kind: 0 | named', 'meta_key: 0 | Alice',
        'meta_token: 0 | rA7', 'meta_frame: 0 | half_body', 'meta_outfit_name: 0 | Coat',
        'meta_outfit_description: 0 | A blue coat.',
        ...(candidate ? Object.entries(views).map(([frame, view]) => `meta_dna_${frame}: 0 | ${view.subject}`) : [])].join('\n');
    return { reply, promptTask, characterContext, subject };
}

test('gate:dna-template:内置单次写词经真实解析和发送保留正文与候选', async () => {
    const { createNaiOfficialClient } = await import('../src/generated-images/nai-official-client.js');
    for (const candidate of [false, true]) {
        const fixture = templateWritingFixture(candidate), calls = [], wires = [];
        const nai = createNaiOfficialClient({ fetch: async (_url, init) => {
            wires.push(JSON.parse(init.body));
            return new Response(JSON.stringify({ image: 'data:image/png;base64,AAAA' }),
                { status: 200, headers: { 'Content-Type': 'application/json' } });
        } });
        const backend = createImageBackend({ nai,
            getBridge: () => ({ imageApi: { mode: 'nai' }, autoIllustration: { nai: {
                apiKey: 'fake-key', model: 'nai-diffusion-5-full', artistPrefix: 'artist:global' } } }),
            llm: { async request(messages) { calls.push(messages); return fixture.reply; } } });
        const request = { description: '只画任务 6 的半身人物', promptTask: fixture.promptTask,
            characterContext: fixture.characterContext, userPrompts: { positive: 'soft light', negative: 'blurry' },
            writingRequirements: { transparent: true, quality: 'masterpiece' } };
        const before = structuredClone(request);
        const written = await backend.writeDbgenPrompt(request);
        assert.equal(written.ok, true, written.error);
        assert.equal(calls.length, 1);
        assert.equal(wires.length, 0);
        assert.match(calls[0].system, /不等待发送层补词/);
        assert.match(calls[0].user, /writingRequirements/);
        assert.match(calls[0].user, /rA7/);
        assert.equal(written.captions[0].slotId, 6);
        assert.equal(written.width, 832);
        assert.equal(Boolean(written.dnaCandidates), candidate);
        assert.deepEqual(written.promptRecipe.caption, written.caption);
        const painted = await backend.generateDbgenCaption({ ...written,
            characterContext: fixture.characterContext, transparent: true, size: '832x1216' });
        assert.equal(painted.ok, true, painted.error);
        assert.equal(wires.length, 1);
        assert.equal(wires[0].input, 'artist:global, ' + written.caption.v4_prompt.caption.base_caption);
        assert.equal(wires[0].parameters.v4_prompt.caption.char_captions[0].char_caption,
            fixture.subject + ' wears a blue coat and waves toward Bob.');
        assert.deepEqual(wires[0].parameters.v4_prompt.caption.char_captions[0].centers, [{ x: 0.23, y: 0.51 }]);
        assert.deepEqual(painted.sentPrompt.caption.v4_prompt.caption, wires[0].parameters.v4_prompt.caption);
        assert.equal(painted.dnaSnapshot.characters[0].source, candidate ? 'candidate' : 'saved');
        assert.equal(calls.length, 1);
        assert.deepEqual(request, before);
    }
});

test('gate:dna-template:内置非法回复不重试且其他来源不接管任务', async () => {
    const fixture = templateWritingFixture(true);
    for (const reply of ['', '抱歉，无法生成', fixture.reply + '\nmeta_token: 0 | rA7',
        fixture.reply + '\nmeta_unknown: 0 | x', fixture.reply.replace('prompt_mode: dna_template', ''),
        fixture.reply.replace('meta_frame: 0 | half_body', ''), fixture.reply.replace('char_uc: <<dna_uc:rA7>>, closed eyes', '')]) {
        const calls = [];
        const backend = createImageBackend({ getBridge: () => ({ imageApi: { mode: 'nai' } }),
            llm: { async request(messages) { calls.push(messages); return reply; } },
            nai: { async generate() { assert.fail('非法写词不得发送图片'); } } });
        assert.equal((await backend.writeDbgenPrompt({ ...fixture, description: '任务 6' })).ok, false);
        assert.equal(calls.length, 1);
    }
    for (const mode of ['baibai', 'extension']) {
        const backend = createImageBackend({ getBridge: () => ({ imageApi: { mode } }),
            llm: { async request() { assert.fail('其他来源不得接管模板写词'); } } });
        assert.equal((await backend.writeDbgenPrompt({ ...fixture, description: '任务 6' })).reason, 'PROMPT_MODE_CONFLICT');
    }
    const backend = createImageBackend({ getBridge: () => ({ imageApi: { mode: 'nai' } }),
        llm: { async request() { return fixture.reply; } } });
    assert.equal((await backend.writeDbgenPrompt({ ...fixture, description: '任务 6',
        promptTask: { ...fixture.promptTask, purpose: 'cg' } })).reason, 'PROMPT_MODE_CONFLICT');
});

test('gate:dna-template:DBGen 两个写词入口透传约束且旧请求形状不变', async () => {
    const { buildPipeline } = await import('../../../nai-dbgen/tests/application/_fakes.js');
    const { Ok } = await import('../../../nai-dbgen/src/infra/result.js');
    for (const method of ['writeDbgenPrompt', 'writeDbgenFloorPrompts']) {
        const fixture = templateWritingFixture(), calls = [];
        const p = buildPipeline({ llmComplete: async () => Ok({ text: fixture.reply, json: null }) });
        const api = {
            async generate() { assert.fail('写词测试不得出图'); },
            async generateSinglePrompt(req) {
            calls.push(req);
            if (!req.promptTask) return Ok({ caption: parseCaptionSlots('scene: Legacy.').captions[0].caption });
            return p.workbench.writePrompt({ mode: 'floor', skipRecall: true,
                naturalLanguage: req.description, characterContext: req.characterContext,
                promptTask: req.promptTask,
                ...(req.userPrompts !== undefined && { userPrompts: req.userPrompts }),
                ...(req.writingRequirements !== undefined && { writingRequirements: req.writingRequirements }) });
        } };
        const backend = createImageBackend({ global: { NaiDbGen: api },
            getBridge: () => ({ imageApi: { mode: 'dbgen' } }) });
        const userPrompts = { positive: 'soft light', negative: 'blurry' };
        const writingRequirements = { width: 832, height: 1216, transparent: true, quality: 'masterpiece' };
        const input = { description: 'Alice portrait', promptTask: fixture.promptTask,
            characterContext: fixture.characterContext, userPrompts, writingRequirements };
        const before = structuredClone(input);
        const result = await backend[method](input);
        assert.equal(result.ok, true, result.error);
        assert.deepEqual(calls[0].userPrompts, userPrompts);
        assert.deepEqual(calls[0].writingRequirements, writingRequirements);
        assert.notEqual(calls[0].userPrompts, userPrompts);
        assert.notEqual(calls[0].writingRequirements, writingRequirements);
        const content = p.llmCalls[0].messages.at(-1).content;
        assert.deepEqual(JSON.parse(content.split('本次写词约束：\n')[1].split('\n')[0]),
            { userPrompts, writingRequirements });
        assert.equal(p.llmCalls.length, 1);
        assert.equal(p.naiCalls.length, 0);
        assert.deepEqual(input, before);
        assert.equal((await backend[method]({ description: 'legacy', userPrompts, writingRequirements })).ok, true);
        assert.deepEqual(calls[1], { description: 'legacy',
            ...(method === 'writeDbgenPrompt' && { skipRecall: true }) });
    }
});

test('gate:dna-template:必需角色遗漏失败而 CG 允许池支持逐图子集', async () => {
    const { parseTemplateCaptionSlots } = await import('../src/generated-images/illustration/template-caption-parser.js');
    const fixture = templateWritingFixture();
    const input = { promptTask: { ...fixture.promptTask, characters: [...fixture.promptTask.characters,
        { characterKey: 'Bob', token: 'rB9', framing: 'half_body' }] },
        characterContext: [...fixture.characterContext, { characterKey: 'Bob', dna: {} }] };
    for (const purpose of ['sprite', 'derived']) {
        const parsed = parseTemplateCaptionSlots(fixture.reply,
            { ...input, promptTask: { ...input.promptTask, purpose } });
        assert.equal(parsed.ok, false);
        assert.equal(parsed.reason, 'DNA_TEMPLATE_BINDING');
    }
    const text = fixture.reply + '\n---\n' + fixture.reply.replace('slotid: 6', 'slotid: 9')
        .replace('size: 832x1216', 'size: 1216x832');
    const parsed = parseTemplateCaptionSlots(text, input);
    assert.equal(parsed.ok, true, parsed.error);
    assert.deepEqual(parsed.captions.map((c) => [c.slotId, c.width, c.height]),
        [[6, 832, 1216], [9, 1216, 832]]);
    for (const item of parsed.captions) {
        assert.equal(item.promptRecipe.bindings.length, 1);
        assert.equal(item.promptRecipe.bindings[0].characterKey, 'Alice');
        assert.equal(item.dnaCandidates, undefined);
    }
});

test('gate:dna-template:内置多 slot 同次写词保留独立候选与尺寸', async () => {
    const fixture = templateWritingFixture(true), calls = [];
    const reply = fixture.reply + '\n---\n' + fixture.reply.replace('slotid: 6', 'slotid: 9')
        .replace('size: 832x1216', 'size: 1216x832');
    const backend = createImageBackend({ getBridge: () => ({ imageApi: { mode: 'nai' } }),
        llm: { async request(input) { calls.push(input); return reply; } },
        nai: { async generate() { assert.fail('写词不得出图'); } } });
    const result = await backend.writeDbgenPrompt({ ...fixture, description: '写两份独立立绘模板' });
    assert.equal(result.ok, true, result.error);
    assert.equal(calls.length, 1);
    assert.deepEqual(result.captions.map((c) => [c.slotId, c.width, c.height]),
        [[6, 832, 1216], [9, 1216, 832]]);
    assert.deepEqual(result.captions[0].dnaCandidates, result.captions[1].dnaCandidates);
    assert.notEqual(result.captions[0].dnaCandidates, result.captions[1].dnaCandidates);
    assert.deepEqual(result.captions[0].promptRecipe.caption, result.captions[0].caption);
    assert.deepEqual(result.captions[1].promptRecipe.caption, result.captions[1].caption);
});

test('gate:dna-template:批量 slot 显式角色映射贯通解析与唯一准备入口', async () => {
    const { parseTemplateCaptionSlots } = await import('../src/generated-images/illustration/template-caption-parser.js');
    const { checkPromptTask } = await import('../src/schemas/prompt-recipe.js');
    const { prepareCharacterCaption } = await import('../src/generated-images/character-caption.js');
    const fixture = templateWritingFixture(true);
    const task = { ...fixture.promptTask, characters: [...fixture.promptTask.characters,
        { characterKey: 'Bob', token: 'rB9', framing: 'half_body' }],
        slots: [{ slotId: 6, tokens: ['rA7'] }, { slotId: 9, tokens: ['rB9'] }] };
    const context = [...fixture.characterContext, { characterKey: 'Bob', dna: {} }];
    const before = structuredClone(task);
    const bob = fixture.reply.replace('slotid: 6', 'slotid: 9').replaceAll('Alice', 'Bob').replaceAll('rA7', 'rB9');
    const reply = bob + '\n---\n' + fixture.reply;
    const parsed = parseTemplateCaptionSlots(reply, { promptTask: task, characterContext: context });
    assert.equal(parsed.ok, true, parsed.error);
    assert.deepEqual(parsed.captions.map((c) => [c.slotId, c.characterMeta.characters[0].characterKey]), [[9, 'Bob'], [6, 'Alice']]);
    for (const item of parsed.captions) {
        const prepared = prepareCharacterCaption({ ...item, promptTask: task, characterContext: context });
        assert.equal(prepared.ok, true, prepared.error);
        assert.equal(prepared.dnaSnapshot.characters.length, 1);
        assert.equal(prepared.dnaSnapshot.characters[0].characterKey, item.characterMeta.characters[0].characterKey);
        assert.equal(prepareCharacterCaption({ ...item, slotId: 8, promptTask: task, characterContext: context }).ok, false);
    }
    for (const bad of [reply.replace('slotid: 9', 'slotid: 8'),
        bob.replace('slotid: 9', 'slotid: 6')])
        assert.equal(parseTemplateCaptionSlots(bad, { promptTask: task, characterContext: context }).ok, false);
    assert.equal(checkPromptTask({ ...task, slots: [task.slots[0]] }, context).ok, false);
    assert.deepEqual(task, before);
});

test('gate:dna-template:普通 CG 写词诊断区分 DBGen 和 IGS 拒绝且只传受控字段', async () => {
    const { buildPipeline } = await import('../../../nai-dbgen/tests/application/_fakes.js');
    const { Ok } = await import('../../../nai-dbgen/src/infra/result.js');
    for (const method of ['writeDbgenPrompt', 'writeDbgenFloorPrompts']) {
        const fixture = templateWritingFixture();
        const input = { description: 'Alice CG', characterContext: [{ characterKey: 'Alice', dna: {} }],
            promptTask: { ...fixture.promptTask, characters: [{ characterKey: 'Alice', token: 'rA7', kind: 'named' }] } };
        const reply = fixture.reply.replace('meta_frame: 0 | half_body', '');
        const p = buildPipeline({ llmComplete: async () => Ok({ text: reply, json: null }) });
        let calls = 0;
        const backend = createImageBackend({ getBridge: () => ({ imageApi: { mode: 'dbgen' } }),
            global: { NaiDbGen: { async generate() { assert.fail('写词不得出图'); },
                async generateSinglePrompt(req) {
                calls++;
                return p.workbench.writePrompt({ mode: 'floor', skipRecall: true, traceId: 'trace_diag_1',
                    naturalLanguage: req.description, characterContext: req.characterContext, promptTask: req.promptTask });
            } } } });
        const failed = await backend[method](input);
        assert.equal(failed.ok, false);
        assert.equal(failed.reason, 'DNA_TEMPLATE_BINDING');
        assert.deepEqual(failed.diagnostic, { code: 'DNA_TEMPLATE_BINDING', stage: 'prompt-parse',
            field: 'meta_frame', issue: 'missing', slotId: 6, captionIndex: 0, traceId: 'trace_diag_1' });
        assert.match(failed.error, /DBGen 回复解析.*DNA_TEMPLATE_BINDING.*meta_frame.*slotId=6.*captionIndex=0/);
        assert.doesNotMatch(JSON.stringify(failed), /Alice|rA7|blue coat|rawText/);
        assert.equal(calls, 1);
        assert.equal(p.llmCalls.length, 1);
        assert.equal(p.naiCalls.length, 0);
        const rejected = await backend[method]({ ...input, promptTask: { ...input.promptTask,
            characters: [{ characterKey: 'Alice', token: 'invalid token' }] } });
        assert.equal(rejected.reason, 'DNA_TEMPLATE_BINDING');
        assert.deepEqual(rejected.diagnostic, { code: 'DNA_TEMPLATE_BINDING', stage: 'igs-prompt-input',
            field: 'promptTask.characters.token', issue: 'invalid', characterIndex: 0 });
        assert.equal(calls, 1);
    }
});

test('gate:scene-only:DBGen 双入口接受无人场景及非身份主体，不放过人物或身份槽', async () => {
    const { buildPipeline } = await import('../../../nai-dbgen/tests/application/_fakes.js');
    const { Ok } = await import('../../../nai-dbgen/src/infra/result.js');
    const { prepareCharacterCaption } = await import('../src/generated-images/character-caption.js');
    const scene = 'slotid: 6\nscene: An empty moonlit courtyard.\nscene_uc: blurry';
    const fixture = templateWritingFixture();
    for (const method of ['writeDbgenPrompt', 'writeDbgenFloorPrompts']) {
        for (const reply of [scene, scene + '\nprompt_mode: dna_template',
            scene + '\nprompt_mode: dna_template\nchar: A stone statue.\nchar_uc: broken\nmeta_kind: 0 | object']) {
            const requests = [];
            const p = buildPipeline({ llmComplete: async () => Ok({ text: reply, json: null }) });
            const backend = createImageBackend({ getBridge: () => ({ imageApi: { mode: 'dbgen' } }),
                global: { NaiDbGen: { async generate() { assert.fail('写词不出图'); },
                    async generateSinglePrompt(req) {
                        requests.push(req);
                        return p.workbench.writePrompt({ mode: 'floor', skipRecall: true,
                            naturalLanguage: req.description });
                    } } } });
            const result = await backend[method]({ description: '无人庭院背景' });
            assert.equal(result.ok, true, result.error);
            assert.equal(Object.hasOwn(requests[0], 'promptTask'), false);
            assert.equal(Object.hasOwn(requests[0], 'characterContext'), false);
            for (const entry of result.captions) {
                const prepared = prepareCharacterCaption(entry);
                assert.equal(prepared.ok, true, prepared.error);
                assert.deepEqual(prepared.caption, entry.caption);
            }
            assert.equal(p.llmCalls.length, 1);
            assert.equal(p.naiCalls.length, 0);
        }
        for (const reply of [fixture.reply, scene.replace('An empty moonlit courtyard.', '<<dna:rA7>>')
            + '\nprompt_mode: dna_template']) {
            const p = buildPipeline({ llmComplete: async () => Ok({ text: reply, json: null }) });
            const backend = createImageBackend({ getBridge: () => ({ imageApi: { mode: 'dbgen' } }),
                global: { NaiDbGen: { async generate() { assert.fail('拒绝后不得出图'); },
                    async generateSinglePrompt() { return p.workbench.writePrompt({ mode: 'floor',
                        skipRecall: true, naturalLanguage: '背景' }); } } } });
            assert.equal((await backend[method]({ description: '背景' })).ok, false);
            assert.equal(p.naiCalls.length, 0);
        }
    }
});
