import test from 'node:test';
import assert from 'node:assert/strict';

// 事务单测直接注入内置端口；实际 NAI 装配另由 builtinFixture 覆盖。
async function consistencyFixture(count = 2, storeOverride) {
    const { createAutoIllustrationService } = await import('./helpers/media-fixtures.js');
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
        async encodePixels(value) { const id = `data:image/png;base64,${Buffer.from(`pixels-${++encoded}`).toString('base64')}`; pixels.set(id, value); return id; },
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
    const backend = { describeEdit: (_bridge, request = {}) => ({ supported: true, via: 'nai', model: request.model,
        infillImg2imgStrength: 1, appearanceCorrection: 1, infillModelNegotiation: 1, providedPromptContext: 1 }),
        async getEditConfig({ model } = {}) { return { ok: true, version: 1, configToken: 'fixture-config', model, artist: null, isCurrent: () => true }; },
        async writeDbgenPrompt(request) {
            writes.push(request);
            const captions = request.promptTask.slots.map(({ slotId, tokens, identityMode }) => {
                const rows = tokens.map((token) => request.promptTask.characters.find((c) => c.token === token));
                const outfitFor = c => request.characterContext.find(m => m.characterKey === c.characterKey).outfit;
                const ref = rows.find((c) => c.kind === 'reference');
                const caption = {
                    v4_prompt: { caption: { base_caption: ref
                        ? 'The inset shows the same character as an appearance reference. Two people interacting in a room, preserving their original clothing and interaction.'
                        : 'Two people interacting in a room.', char_captions: rows.map((c) => ({
                        char_caption: `<<dna:${c.token}>> ${c.kind === 'reference' ? 'is visible from the shoulders up.' : request.promptTask.outfitMode === 'template' ? `<<outfit:${c.token}>>.` : `wears ${outfitFor(c).description}.`}`,
                        centers: [{ x: 0.5, y: 0.5 }] })) } },
                    v4_negative_prompt: { caption: { base_caption: ref ? 'decorative frame, golden border, split screen, collage, duplicate person' : '', char_captions: rows.map((c) => ({ char_caption: `<<dna_uc:${c.token}>>` })) } },
                };
                return { slotId, caption, promptRecipe: { version: 1, mode: 'dna_template', caption,
                    ...(identityMode !== undefined && { identityMode }),
                    ...(request.promptTask.outfitMode && { outfitMode: request.promptTask.outfitMode }),
                    bindings: rows.map((c, captionIndex) => ({ ...c, captionIndex,
                        ...(identityMode !== undefined && { correction: {
                            subject: `new-${c.characterKey}`, negative: `correction-uc-${c.characterKey}`,
                        } }) })) },
                    characterMeta: { version: 1, characters: rows.flatMap((c, captionIndex) => c.kind === 'reference' ? [] : [{
                        ...structuredClone(characters.find((m) => m.characterKey === c.characterKey)), captionIndex,
                        outfit: structuredClone(outfitFor(c)),
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

test('gate:cg-consistency:固定前缀归一与重复准备不改局部模板', async () => {
    const { prepareCharacterCaption } = await import('../src/generated-images/character-caption.js');
    const f = await consistencyFixture();
    const started = await f.service.redrawConsistency(f.query);
    assert.equal(started.ok, true, JSON.stringify(started));
    const request = f.calls[0];
    const template = structuredClone({ caption: request.caption, promptRecipe: request.promptRecipe,
        promptTask: request.promptTask, characterContext: request.characterContext,
        characterMeta: request.characterMeta, slotId: request.slotId });
    const scene = template.caption.v4_prompt.caption.base_caption;
    const cases = [
        [scene, scene],
        [`reference inset, ${scene}`, scene],
        [`  ReFeReNcE InSeT. ${scene}`, scene],
        [`${scene}, reference inset`, scene],
        [`reference inset; reference inset, ${scene}, reference inset`, scene],
        ['Local content, reference inset, same character.', 'Local content, same character.'],
        ['reference inset', ''],
        ['A reference inset is described in the scene.', 'A reference inset is described in the scene.'],
    ];
    for (const [raw, body] of cases) {
        const input = structuredClone(template);
        input.caption.v4_prompt.caption.base_caption = raw;
        input.promptRecipe.caption = structuredClone(input.caption);
        const before = structuredClone(input);
        const prepared = prepareCharacterCaption(input);
        assert.equal(prepared.ok, true, prepared.error);
        assert.equal(prepared.caption.v4_prompt.caption.base_caption,
            body ? `reference inset, ${body}` : 'reference inset');
        assert.deepEqual(input, before, '只修改发送副本');
        assert.deepEqual(prepared.promptRecipe.caption, before.promptRecipe.caption);
        assert.deepEqual(prepareCharacterCaption(input), prepared, '同模板重复准备保持幂等');
        const final = prepareCharacterCaption({ captionMode: 'final', caption: prepared.caption });
        assert.equal(final.ok, true, final.error);
        assert.deepEqual(final.caption, prepared.caption, '已准备的定稿不重复前置');
        assert.equal(Object.isFrozen(prepared.caption.v4_prompt.caption), true);
    }
    assert.deepEqual(await f.store.getSlotRecord(f.before.key), f.before);
});


test('gate:cg-consistency:固定前缀不影响普通生成与手改定稿', async () => {
    const { prepareCharacterCaption } = await import('../src/generated-images/character-caption.js');
    const f = await consistencyFixture();
    const recipe = structuredClone(f.before.promptRecipe);
    const characterContext = f.names.map(characterKey => ({ characterKey,
        dna: f.assets.characterDna[characterKey],
        outfit: f.before.characterMeta.characters.find(c => c.characterKey === characterKey).outfit }));
    for (const purpose of ['cg', 'sprite', 'derived', 'consistency']) {
        const input = { caption: recipe.caption, promptRecipe: recipe, characterContext,
            characterMeta: f.before.characterMeta,
            promptTask: { version: 1, mode: 'dna_template', purpose,
                characters: recipe.bindings.map(({ kind, characterKey, token, framing }) =>
                    ({ kind, characterKey, token, framing })) } };
        const before = structuredClone(input);
        const prepared = prepareCharacterCaption(input);
        assert.equal(prepared.ok, true, prepared.error);
        assert.equal(prepared.caption.v4_prompt.caption.base_caption, recipe.caption.v4_prompt.caption.base_caption);
        assert.doesNotMatch(prepared.caption.v4_prompt.caption.base_caption, /reference inset/i);
        assert.deepEqual(input, before);
        assert.ok(prepared.caption.v4_prompt.caption.char_captions.every(c => !c.char_caption.includes('<<dna:')));
    }
    for (const captionMode of [undefined, 'final']) {
        const caption = structuredClone(f.before.caption);
        caption.v4_prompt.caption.base_caption = 'reference inset, An explicitly saved caption.';
        const before = structuredClone(caption);
        const prepared = prepareCharacterCaption({ caption, ...(captionMode && { captionMode }) });
        assert.equal(prepared.ok, true, prepared.error);
        assert.deepEqual(prepared.caption, before, '旧提示词和手改定稿原样发送');
        assert.deepEqual(caption, before);
    }
});


for (const count of [2, 3]) test(`gate:cg-consistency:${count}-characters-candidate-accept-roundtrip`, async () => {
    const f = await consistencyFixture(count);
    const candidate = await f.service.redrawConsistency(f.query);
    assert.equal(candidate.ok, true, JSON.stringify(candidate));
    assert.equal(candidate.reason, 'candidate');
    assert.equal(f.calls.length, count);
    assert.equal(f.writes.length, count, '仅为局部工作轮次写词');
    assert.ok(f.writes.every((request) => request.contextMode === 'provided' && !Object.hasOwn(request, 'messageId')), '仅使用保存 CG 资料');
    assert.equal(f.writes[0].promptTask.purpose, 'consistency');

    const output = JSON.parse(f.writes[0].description.split('\n').at(-1));
    assert.equal(output.characterKey, f.names[0]);
    assert.deepEqual(output.layout.sourceSize, { width: 128, height: 64 });
    assert.ok(output.layout.crop && output.layout.work && output.layout.reference);

    assert.deepEqual(f.references, f.names);
    assert.deepEqual(await f.store.getSlotRecord(f.before.key), f.before, '候选前不写正式记录');
    assert.deepEqual([candidate.width, candidate.height], [128, 64]);
    for (const [i, request] of f.calls.entries()) {
        assert.equal(await request.shouldStart(), true);
        assert.equal(request.strength, 0.6, '一致性每轮显式使用专用重绘强度');
        assert.match(request.caption.v4_prompt.caption.base_caption, /preserving their original clothing and interaction/);
        assert.match(request.caption.v4_prompt.caption.base_caption, /same character/i);
        assert.doesNotMatch(request.caption.v4_prompt.caption.base_caption, /reference inset/i);
        assert.doesNotMatch(request.caption.v4_prompt.caption.base_caption, /frame|border|split screen|collage/i);
        assert.match(request.caption.v4_negative_prompt.caption.base_caption, /decorative frame, golden border, split screen, collage, duplicate person/);
        const chars = request.caption.v4_prompt.caption.char_captions;
        assert.ok(chars.every((c) => c.centers.every((p) => p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1)));
        assert.ok(chars.some((c) => c.char_caption.includes(`<<dna:ref${i}>>`)));
        assert.ok(chars.every((c) => !c.char_caption.includes('new-')), '服务不能提前展开身份');
        const { prepareCharacterCaption } = await import('../src/generated-images/character-caption.js');
        const reusable = structuredClone({ caption: request.caption, promptRecipe: request.promptRecipe });
        const prepared = prepareCharacterCaption(request);
        assert.equal(prepared.ok, true, prepared.error);
        const scene = prepared.caption.v4_prompt.caption.base_caption;
        assert.equal(scene, `reference inset, ${request.caption.v4_prompt.caption.base_caption}`);
        assert.equal(scene.match(/reference inset/gi).length, 1);
        assert.deepEqual({ caption: request.caption, promptRecipe: request.promptRecipe }, reusable, '准备发送不能修改局部模板');
        assert.deepEqual(prepared.promptRecipe.caption, request.promptRecipe.caption);
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
    assert.deepEqual(saved.characterMeta, f.before.characterMeta);
    assert.deepEqual(saved.caption, f.before.caption);
    assert.deepEqual(saved.promptRecipe, f.before.promptRecipe);
    assert.equal(saved.sentPrompt, undefined, '合成后的正式 CG 没有伪造整图 wire');
    assert.equal(saved.consistencyPrompt.rounds.length, count);
    assert.deepEqual(saved.consistencyPrompt.rounds.map((r) => r.characterKey), f.names);
    assert.ok(saved.consistencyPrompt.rounds.every((r) => r.sentPrompt.action === 'infill'));
    for (const round of saved.consistencyPrompt.rounds) {
        assert.match(round.sentPrompt.caption.v4_prompt.caption.base_caption, /^reference inset, /);
        assert.equal(round.sentPrompt.caption.v4_prompt.caption.base_caption.match(/reference inset/gi).length, 1);
    }
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
function consistencyFlatReply(request) {
    const output = JSON.parse(request.description.split('\n').at(-1));
    assert.equal(request.promptTask.slots.length, 1);
    assert.equal(output.slotId, request.promptTask.slots[0].slotId);
    assert.deepEqual(output.rows.map((r) => r.captionIndex), output.rows.map((_, i) => i));
    assert.deepEqual(output.rows.map((r) => r.token), request.promptTask.slots[0].tokens);
    assert.deepEqual(request.characterContext.map((c) => c.characterKey).sort(),
        [...new Set(output.rows.map((r) => r.characterKey))].sort());

    const lines = [`slotid: ${output.slotId}`, 'prompt_mode: dna_template',
        ...(output.identityMode !== undefined ? [`identity_mode: ${output.identityMode}`] : []),
        `size: ${output.size.width}x${output.size.height}`, 'scene: The inset shows the same character. People retain their original pose in a room.', 'scene_uc: blurry'];
    for (const row of output.rows) {
        const i = row.captionIndex, center = row.centers[0];
        if (row.kind === 'reference') assert.deepEqual(row.outfit, { name: '', description: '' });
        lines.push(`char: ${center.x},${center.y} | <<dna:${row.token}>> ${row.kind === 'reference'
            ? 'is visible from the shoulders up.' : `wears ${row.outfit.description}.`}`,
        `char_uc: <<dna_uc:${row.token}>>`, `meta_kind: ${i} | ${row.kind}`,
        `meta_key: ${i} | ${row.characterKey}`, `meta_token: ${i} | ${row.token}`,
        `meta_frame: ${i} | ${row.framing}`, `meta_outfit_name: ${i} | ${row.outfit.name}`,
        `meta_outfit_description: ${i} | ${row.outfit.description}`,
        ...(output.identityMode !== undefined ? [`meta_correction_identity: ${i} | new-${row.characterKey}`,
            `meta_correction_uc: ${i} | correction-uc-${row.characterKey}`] : []));
    }
    return { output, text: lines.join('\n') };
}

async function consistencyBuiltinFixture(count = 2, model = 'nai-diffusion-5-full-inpainting', options = {}) {
    const { createImageBackend } = await import('../src/generated-images/image-backend.js');
    const { createCgConsistencyService } = await import('../src/generated-images/illustration/cg-consistency-service.js');
    const { createIndexedDbIllustrationStore } = await import('../src/media/illustration-store.js');
    const { createTransactionalIdb } = await import('./helpers/transactional-idb.js');
    const { createMemoryStorage, createPresetRegistry } = await import('../src/index.js');
    const { createBuiltinImageTaskRuntime } = await import('../src/generated-images/builtin-image-task-runtime.js');
    const { createImagePromptLlm } = await import('../src/generated-images/image-prompt-runtime.js');
    const { createNaiOfficialClient } = await import('../src/generated-images/nai-official-client.js');
    const { createNaiRequestQueue } = await import('../src/generated-images/nai-request-queue.js');
    const { pngFixture } = await import('./helpers/png-fixture.js');
    const indexedDB = createTransactionalIdb();
    const rawStore = createIndexedDbIllustrationStore({ indexedDB });
    const f = await consistencyFixture(count, rawStore);
    f.assets.characterOutfits = {};
    f.assets.characterDefaultOutfits = {};
    f.assets.characterSeeds = Object.fromEntries(f.names.map((name, i) => [name, i === 0 ? 0 : 42 + i]));
    f.assets.wardrobe = {};
    for (const name of f.names) {
        f.assets.characterOutfits[name] = { 冬装: { wardrobe: name, moods: { 平和: `reference-${name}` } } };
        f.assets.characterDefaultOutfits[name] = { version: 1, outfitName: '冬装' };
        f.assets.wardrobe[name] = { prompt: `coat-${name}` };
    }
    const appearanceListeners = new Set(), referenceRevisions = new Map();
    const appearanceScope = { key: 'fixture-scope', owner: 'fixture-owner' };
    const readReferenceImage = async url => f.pixels.has(url)
        ? { type: 'sprite', dataUrl: url, revision: referenceRevisions.get(url) || 1 } : null;
    const store = options.wrapStore?.(rawStore) || rawStore;
    const bridge = { imageApi: { mode: 'nai' }, autoIllustration: { consistencyModel: model,
        nai: { apiKey: 'fixture-builtin-key', model: 'nai-diffusion-4-full', artistPrefix: 'artist:fixture' } } };
    const registry = createPresetRegistry({ storage: createMemoryStorage() });
    const runtime = createBuiltinImageTaskRuntime({ readBridge: () => bridge, registry });
    const writes = [], wires = [], edits = [], gates = [];
    let active = 0, maxActive = 0, live = true;
    function encode(value) {
        const stride = value.width * 4 + 1, scanlines = Buffer.alloc(stride * value.height);
        for (let row = 0; row < value.height; row++)
            scanlines.set(value.data.subarray(row * value.width * 4, (row + 1) * value.width * 4), row * stride + 1);
        const png = pngFixture(value.width, value.height, { scanlines });
        f.pixels.set(png.dataUrl, { ...value, data: new Uint8ClampedArray(value.data) });
        return png;
    }
    const codec = { ...f.codec, async encodePixels(value) { return encode(value).dataUrl; } };
    const pause = async () => {
        if (!options.waitPaint) return;
        await new Promise(resolve => gates.push(resolve));
    };

    const llm = createImagePromptLlm({ async request(request, settings) {
        writes.push({ request, settings });

        const input = JSON.parse(request.messages.find(message => message.content.startsWith('{')).content);
        const rows = input.outputs.rows;
        const slot = input.promptTask.slots[0];
        assert.equal(input.outputs.slotIds.length, 1);
        assert.deepEqual(input.outputs.slotIds, [slot.slotId]);
        const reply = [`slotid: ${slot.slotId}`, 'prompt_mode: dna_template',
            ...(input.promptTask.outfitMode === 'template' ? ['outfit_mode: template'] : []),
            ...(slot.identityMode !== undefined ? [`identity_mode: ${slot.identityMode}`] : []),
            'scene: People interacting in a room. The inset is an appearance reference only. High quality illustration.',
            'scene_uc: blurry, decorative frame, duplicate person',
            ...rows.flatMap((row, index) => [
                `char: ${row.centers[0].x},${row.centers[0].y} | <<dna:${row.token}>> ${row.kind === 'reference'
                    ? 'is visible from the shoulders up.' : input.promptTask.outfitMode === 'template'
                        ? `<<outfit:${row.token}>>.` : `wears ${row.outfit.description}.`}`,
                `char_uc: <<dna_uc:${row.token}>>`,
                `meta_kind: ${index} | ${row.kind}`, `meta_key: ${index} | ${row.characterKey}`,
                `meta_token: ${index} | ${row.token}`, `meta_frame: ${index} | ${row.framing}`,
                `meta_outfit_name: ${index} | ${row.outfit.name}`,
                `meta_outfit_description: ${index} | ${row.outfit.description}`,
                ...(slot.identityMode !== undefined ? [`meta_correction_identity: ${index} | new-${row.characterKey}`,
                    `meta_correction_uc: ${index} | wrong-${row.characterKey}`] : []),
            ])].join('\n');
        if (options.waitWrite) await new Promise(resolve => gates.push(resolve));
        return options.transformReply ? options.transformReply(reply, input) : reply;
    } }, registry, runtime);
    const client = createNaiOfficialClient({ queue: createNaiRequestQueue(), random: () => 0.5,
        fetch: async (_url, init) => {
            assert.equal(init.method, 'POST');
            const body = JSON.parse(init.body);
            wires.push(body); active++; maxActive = Math.max(maxActive, active);
            try {
                await pause();
                const { width, height } = body.parameters;
                const data = new Uint8ClampedArray(width * height * 4);
                for (let i = 0; i < data.length; i += 4) data.set([220, wires.length * 40, 20, 255], i);
                return new Response(encode({ width, height, data }).bytes, { headers: { 'Content-Type': 'image/png' } });
            } finally { active--; }
        } });

    const backend = createImageBackend({ nai: client, global: {}, llm,
        getBridge: () => bridge, taskRuntime: runtime });
    const forbidden = ['numberedText', 'previousText', 'lore', 'characters', 'scenes',
        'messageId', 'skipRecall', 'history', 'characterLibrary', 'tagLibrary'];
    const service = createCgConsistencyService({ store, codec, nai: { ...backend,
        writePrompt(request) {
            for (const key of forbidden) Object.defineProperty(request, key, { enumerable: true,
                get() { assert.fail(`provided 不得读取 ${key}`); } });
            return backend.writePrompt(request);
        },
        edit(request) { edits.push(request); return backend.edit(request); },
    }, getSceneAssets: () => f.assets,
        consistencyModel: () => bridge.autoIllustration.consistencyModel,
        resolveReference: (key, assets) => assets.characters[key].默认,
        readReferenceImage: options.readReferenceImage || readReferenceImage,
        captureAppearanceScope: () => structuredClone(appearanceScope),
        subscribeAppearance(handler) { appearanceListeners.add(handler); return () => appearanceListeners.delete(handler); },
        ...(options.report && { report: options.report }),
        targetStillLive: () => live,
        writingRequirements: () => ({ transparent: false, quality: 'High quality illustration.',
            undesiredContent: 'blurry' }),
        ...(options.onAccepted && { onAccepted: options.onAccepted }) });
    return { ...f, store, rawStore, service, codec, indexedDB, bridge, registry, runtime,
        writes, wires, edits, gates, forbidden, backend, llm,
        appearanceScope, referenceRevisions,
        appearanceChanged(detail = {}) { for (const handler of appearanceListeners) handler(detail); },
        get appearanceSubscriptions() { return appearanceListeners.size; },
        originalAssets: structuredClone(f.assets),
        target: { key: f.key, floor: f.floor, slot: 7 },
        get maxActive() { return maxActive; }, get active() { return active; },
        setLive(value) { live = value; },
        release() { gates.splice(0).forEach(resolve => resolve()); },
        dispose() { gates.splice(0).forEach(resolve => resolve()); runtime.dispose(); } };
}

for (const model of ['nai-diffusion-4-5-full-inpainting', 'nai-diffusion-5-full-inpainting']) {
    for (const count of [1, 3]) test(`内置一致性无 DBG：${model} ${count} 人真实写词、infill 与采用`, async t => {
        const f = await consistencyBuiltinFixture(count, model);
        t.after(() => f.dispose());
        const { createGenerationStrip } = await import('../src/visual/igs-ui/generation-strip.js');
        const strip = createGenerationStrip(), phases = [], progressTask = {};
        t.after(() => strip.dispose());
        const cap = f.backend.describeEdit(undefined, { model });
        assert.equal(cap.via, 'nai');
        assert.equal(cap.providedPromptContext, 1);
        const initialOptions = Object.freeze({ onProgress() { assert.fail('生成阶段使用新的进度接收者'); } });
        const ready = await f.service.preflight(f.target, initialOptions);
        assert.equal(ready.reason, 'ready', JSON.stringify(ready));
        const candidate = await f.service.run(f.target, { preflightToken: ready.preflightToken,
            onProgress(detail) {
                phases.push(detail.phase);
                strip.progress(progressTask, detail);
                if (detail.phase !== 'done') {
                    assert.equal(strip.getState().phase, 'busy');
                    assert.match(strip.getState().tip, /一致性重绘：/);
                }
            } });
        assert.equal(candidate.ok, true, JSON.stringify(candidate));
        assert.deepEqual([...new Set(phases)], ['prepare', 'reference', 'write', 'paint', 'compose', 'done']);
        assert.equal(strip.getState().jobs, 0);
        assert.equal(strip.getState().phase, 'done');
        assert.equal(candidate.width, 128); assert.equal(candidate.height, 64);
        assert.equal(f.writes.length, count); assert.equal(f.wires.length, count);
        assert.equal(f.edits.length, count); assert.equal(f.maxActive, 1);
        assert.deepEqual(await f.rawStore.getSlotRecord(f.before.key), f.before);
        for (const { request } of f.writes) {

            const data = JSON.parse(request.messages.find(message => message.content.trim().startsWith('{')).content);
            assert.deepEqual(data.originalPrompt, f.before.promptRecipe.caption);
            assert.ok(data.layout); assert.ok(data.promptTask); assert.ok(data.characterContext.length);
            const edit = f.edits.find(row => row.slotId === data.outputs.slotIds[0]);
            assert.deepEqual(data.outputs.size, { width: edit.width, height: edit.height });
            assert.equal(data.writingRequirements.size, `${edit.width}x${edit.height}`);
            assert.ok(data.layout.work.width < edit.width, '局部工作区不冒充完整参考画布');
            assert.equal(data.writingRequirements.quality, 'High quality illustration.');
            const placement = data.layout.referenceContent;
            assert.ok(placement);
            const reference = data.outputs.rows.find(row => row.kind === 'reference');
            assert.equal(reference.centers[0].x, (placement.x + placement.width / 2) / f.edits[0].width);
            assert.equal(reference.centers[0].y, (placement.y + placement.height / 2) / f.edits[0].height);
            assert.equal(data.outputs.slotIds.length, 1);
            for (const key of f.forbidden) assert.equal(Object.hasOwn(data, key), false, key);
        }
        for (const wire of f.wires) {
            assert.equal(wire.action, 'infill'); assert.equal(wire.model, model);
            assert.equal(wire.parameters.seed, f.assets.characterSeeds[f.names[0]], '全部局部使用第一个角色种子');
            assert.ok(wire.parameters.image); assert.ok(wire.parameters.mask);
            assert.ok(wire.parameters.width * wire.parameters.height <= 1024 * 1024);
            const prompt = JSON.stringify(wire.parameters.v4_prompt);
            assert.ok(prompt.includes('artist:fixture'));
            assert.equal(prompt.includes('<<dna:'), false);
            assert.equal(prompt.includes('<<outfit:'), false);
        }
        assert.equal((await f.service.accept(candidate.candidateId)).ok, true);
        const saved = await f.rawStore.getSlotRecord(f.before.key);
        assert.equal(saved.consistencyBaselineDataUrl, 'original');
        assert.deepEqual(saved.promptRecipe, f.before.promptRecipe);
        assert.deepEqual(saved.caption, f.before.caption);
        assert.deepEqual(saved.characterMeta, f.before.characterMeta);
        assert.deepEqual(saved.consistencyBaselineMeta.promptRecipe, f.before.promptRecipe);
        assert.equal(saved.consistencyPrompt.rounds.length, count);
        for (const round of saved.consistencyPrompt.rounds) {
            assert.equal(round.sentPrompt.action, 'infill'); assert.equal(round.sentPrompt.model, model);
            assert.equal(round.seed, f.assets.characterSeeds[f.names[0]]);
            assert.ok(round.promptRecipe); assert.ok(round.dnaSnapshot);
            assert.equal(round.appearance.version, 1);
            assert.equal(round.appearance.requestedOutfit, '冬装');
            assert.equal(round.appearance.effectiveOutfit, '冬装');
            assert.equal(round.appearance.selectionSource, 'requested');
            assert.equal(round.appearance.confirmed, false);
            assert.match(round.appearance.reference.sourceId, /^[0-9a-f]{16}$/);
            assert.equal(round.appearance.reference.url, undefined, '外部路径只保留受控来源标识');
        }
        assert.deepEqual(f.assets, f.originalAssets);
    });
}

async function waitBuiltinGate(f, count = 1) {
    const deadline = Date.now() + 3000;
    while (f.gates.length < count && Date.now() < deadline)
        await new Promise(resolve => setImmediate(resolve));
    assert.ok(f.gates.length >= count, '隔离端口未到达预期等待点');
}

for (const phase of ['waitWrite', 'waitPaint']) {
    test(`内置一致性取消：${phase} 拒收迟到结果且排队零发送`, async t => {
        let accepted = 0;
        const f = await consistencyBuiltinFixture(3, undefined, { [phase]: true,
            onAccepted: () => accepted++ });
        t.after(() => f.dispose());
        const pending = f.service.run(f.target);
        await waitBuiltinGate(f, phase === 'waitWrite' ? 3 : 1);
        const sent = f.wires.length;
        assert.equal(sent, phase === 'waitPaint' ? 1 : 0);
        assert.equal(f.service.cancel().ok, true);
        const stopped = await pending;
        assert.equal(stopped.ok, false); assert.equal(stopped.reason, 'cancelled');
        f.release();
        await new Promise(resolve => setTimeout(resolve, 30));
        assert.equal(f.wires.length, sent);
        assert.equal(f.active, 0); assert.equal(accepted, 0);
        assert.equal(f.service.isBusy(), false);
        assert.deepEqual(await f.rawStore.getSlotRecord(f.before.key), f.before);
    });
}

for (const change of ['model', 'nai', 'preset']) {
    test(`内置一致性候选保存：${change} 保存后继续采用同一候选`, async t => {
        let accepted = 0;
        const f = await consistencyBuiltinFixture(1, undefined, { onAccepted: () => accepted++ });
        t.after(() => f.dispose());
        const candidate = await f.service.run(f.target);
        assert.equal(candidate.ok, true, JSON.stringify(candidate));
        if (change === 'model') f.bridge.autoIllustration.consistencyModel = 'nai-diffusion-4-5-full-inpainting';
        else if (change === 'nai') f.bridge.autoIllustration.nai.artistPrefix = 'artist:changed';
        else {
            const current = f.registry.getCurrent('prompt-preset');
            const edited = structuredClone(current);
            edited.data.prompts[0].content += '\n只处理明确提供的资料。';
            assert.equal(f.registry.savePromptPreset(edited, current.data.revision).ok, true);
        }
        const result = await f.service.accept(candidate.candidateId);
        assert.equal(result.ok, true, JSON.stringify(result));
        assert.equal(accepted, 1);
        assert.equal((await f.rawStore.getSlotRecord(f.before.key)).dataUrl, candidate.dataUrl);
    });
}


for (const phase of ['waitWrite', 'waitPaint']) {
    test(`内置一致性在途配置变化：${phase} 完成原写词及出图`, { timeout: 6000 }, async t => {
        const f = await consistencyBuiltinFixture(3, undefined, { [phase]: true });
        t.after(() => f.dispose());
        const pending = f.service.run(f.target);
        await waitBuiltinGate(f, phase === 'waitWrite' ? 3 : 1);
        f.bridge.autoIllustration.nai.artistPrefix = 'artist:changed';
        f.runtime.refresh();
        let finished = false;
        pending.finally(() => { finished = true; });
        for (let i = 0; i < 100 && !finished; i++) { f.release(); await new Promise(resolve => setTimeout(resolve, 5)); }
        const candidate = await pending;
        assert.equal(candidate.ok, true, JSON.stringify(candidate));
        assert.equal(f.wires.length, 3);
        assert.equal(f.active, 0);
        assert.deepEqual(await f.rawStore.getSlotRecord(f.before.key), f.before);
        f.service.cancel(candidate.candidateId);
    });
}

for (const conflict of ['config', 'revision']) {
    test(`内置一致性提交事务：${conflict} 在异步复核后变化仍完成原候选保存`, { timeout: 4000 }, async t => {
        let f, changed = false, accepted = 0;
        f = await consistencyBuiltinFixture(1, undefined, {
            onAccepted: () => accepted++,
            wrapStore: raw => ({ ...raw, async updateSlot(...args) {
                const options = args[4];
                args[4] = { ...options, async beforeCommit() {
                    await options.beforeCommit();
                    if (changed) return;
                    changed = true;
                    if (conflict === 'config') {
                        f.bridge.autoIllustration.nai.artistPrefix = 'artist:transaction';
                        f.runtime.refresh();
                    } else await raw.putSlot(f.key, { ...f.before, error: 'concurrent-update' });
                } };
                return raw.updateSlot(...args);
            } }),
        });
        t.after(() => f.dispose());
        const candidate = await f.service.run(f.target);
        assert.equal(candidate.ok, true, JSON.stringify(candidate));
        const saved = await f.service.accept(candidate.candidateId);
        assert.equal(saved.ok, true, JSON.stringify(saved));
        assert.equal(accepted, 1);
        assert.equal((await f.rawStore.getSlotRecord(f.before.key)).dataUrl, candidate.dataUrl);
    });
}


for (const edited of [false, true]) {
    test(`内置一致性保真采用：${edited ? '手改定稿' : '原始双 DNA 模板'}与基线快照不变`, async t => {
        const { prepareCharacterCaption } = await import('../src/generated-images/character-caption.js');
        const { storedPromptFromResult, promptFromText } = await import('../src/generated-images/generation-prompt.js');
        const { prefixFinalArtist, promptSnapshotFromBody } = await import('../src/generated-images/final-caption.js');
        const f = await consistencyBuiltinFixture(2);
        t.after(() => f.dispose());
        const recipe = structuredClone(f.before.promptRecipe);
        recipe.outfitMode = 'template';
        for (const b of recipe.bindings) recipe.caption.v4_prompt.caption.char_captions[b.captionIndex].char_caption
            = `<<dna:${b.token}>> <<outfit:${b.token}>> looks over the shoulder.`;
        const context = f.names.map(characterKey => ({ characterKey, dna: f.assets.characterDna[characterKey],
            outfit: f.before.characterMeta.characters.find(c => c.characterKey === characterKey).outfit }));
        const prepared = prepareCharacterCaption({ ...f.before, caption: recipe.caption, promptRecipe: recipe,
            promptTask: { version: 1, mode: 'dna_template', purpose: 'consistency', outfitMode: 'template',
                characters: recipe.bindings.map(({ kind, characterKey, token, framing }) => ({ kind, characterKey, token, framing })) },
            characterContext: context });
        assert.equal(prepared.ok, true, JSON.stringify(prepared));
        const artist = { positivePrompt: 'artist:original', negativePrompt: '' };
        const original = { ...prepared, sentPrompt: promptSnapshotFromBody({ model: 'nai-diffusion-4-full',
            action: 'generate', parameters: prefixFinalArtist(prepared.caption, artist) }, artist) };
        const prompt = edited ? { ...storedPromptFromResult(original),
            ...promptFromText('EDITED-CG: holding the reins beside a stone wall.', 'edited-uc') }
            : storedPromptFromResult(original);
        if (edited) delete prompt.caption;
        const before = await f.rawStore.putSlot(f.key, { ...f.before, ...original, prompt,
            ...(edited && { promptEdited: true, captionMode: 'final' }) });
        const candidate = await f.service.run(f.target);
        assert.equal(candidate.ok, true, JSON.stringify(candidate));
        for (const { request } of f.writes) {
            const input = JSON.parse(request.messages.find(message => message.content.trim().startsWith('{')).content);
            assert.deepEqual(input.originalPrompt, edited ? prompt : recipe.caption);
            assert.equal(input.promptTask.outfitMode, 'template');
            assert.equal(Object.hasOwn(input.promptTask, 'identityMode'), false);
            assert.equal(input.promptTask.slots[0].identityMode, 'appearance_correction');
        }
        assert.equal((await f.service.accept(candidate.candidateId)).ok, true);
        const saved = await f.rawStore.getSlotRecord(before.key);
        const savedPrompt = structuredClone(before.prompt);
        delete savedPrompt.sentPrompt;
        delete savedPrompt.consistencyPrompt;
        assert.deepEqual(saved.prompt, savedPrompt, '正式 prompt 保真且清除旧发送来源');
        assert.deepEqual(saved.consistencyBaselineMeta.prompt, before.prompt, '基线保留完整旧来源');
        for (const field of ['caption', 'promptRecipe', 'dnaSnapshot', 'outfitSnapshot',
            'characterMeta', 'originalSize', 'captionMode', 'promptEdited']) {
            assert.deepEqual(saved[field], before[field], field);
            assert.deepEqual(saved.consistencyBaselineMeta[field], before[field], `baseline.${field}`);
        }
        assert.equal(saved.sentPrompt, undefined, '合成 CG 不伪造整图发送来源');
        assert.equal(saved.consistencyBaselineDataUrl, before.dataUrl);
        assert.deepEqual(saved.consistencyBaselineMeta.sentPrompt, before.sentPrompt);
        for (const round of saved.consistencyPrompt.rounds) {
            assert.equal(round.promptRecipe.outfitMode, 'template');
            assert.equal(round.promptRecipe.identityMode, 'appearance_correction');
            assert.equal(round.promptRecipe.bindings.filter(b => b.kind === 'reference').length, 1);
            assert.equal(round.sentPrompt.action, 'infill');
            assert.match(round.sentPrompt.caption.v4_prompt.caption.base_caption, /reference inset, /);
            for (const b of round.promptRecipe.bindings.filter(b => b.kind === 'named')) {
                const outfit = context.find(c => c.characterKey === b.characterKey).outfit;
                assert.equal(round.outfitSnapshot.characters.find(c => c.token === b.token).description, outfit.description);
                assert.ok(round.sentPrompt.caption.v4_prompt.caption.char_captions[b.captionIndex].char_caption.includes(outfit.description));
            }
        }
        assert.deepEqual(f.assets, f.originalAssets);
    });
}


for (const mode of ['cancel', 'confirm']) test(`衣装预检：多人集中回退-${mode}`, { timeout: 5000 }, async t => {
    const f = await consistencyBuiltinFixture(2);
    t.after(() => { f.service.cancel(); f.dispose(); });
    for (const name of f.names) {
        f.assets.characterOutfits[name].夏装 = f.assets.characterOutfits[name].冬装;
        f.assets.characterDefaultOutfits[name].outfitName = '夏装';
        f.assets.characterOutfits[name].冬装 = { wardrobe: name, moods: {} };
    }
    const ready = await f.service.preflight(f.target);
    assert.equal(ready.reason, 'needs-confirmation', JSON.stringify(ready));
    assert.equal(ready.confirmations.length, 2);
    assert.equal(f.writes.length, 0); assert.equal(f.wires.length, 0);
    if (mode === 'cancel') {
        f.service.cancel(ready.preflightToken);
        assert.equal(f.service.isBusy(), false);
        assert.equal(f.appearanceSubscriptions, 0);
        assert.equal(f.writes.length, 0); assert.equal(f.wires.length, 0);
        const next = await f.service.preflight(f.target);
        assert.equal(next.ok, true);
        f.service.cancel(next.preflightToken);
    } else {
        assert.equal((await f.service.run(f.target, { preflightToken: ready.preflightToken })).reason, 'confirmation-required');
        const candidate = await f.service.run(f.target, { preflightToken: ready.preflightToken, confirmed: true });
        assert.equal(candidate.ok, true, JSON.stringify(candidate));
        assert.equal(f.writes.length, 2); assert.equal(f.wires.length, 2);
        f.service.cancel(candidate.candidateId);
    }
    assert.deepEqual(await f.rawStore.getSlotRecord(f.before.key), f.before);
});

for (const change of ['wardrobe', 'scope', 'image', 'target'])
test(`衣装预检：来源失效不可复活-${change}`, async t => {
    const f = await consistencyBuiltinFixture(1);
    t.after(() => f.dispose());
    const ready = await f.service.preflight(f.target);
    assert.equal(ready.reason, 'ready', JSON.stringify(ready));
    if (change === 'image') f.referenceRevisions.set('reference-A', 2);
    else if (change === 'target') { f.setLive(false); f.appearanceChanged({ targetChanged: true }); }
    else {
        const object = change === 'default' ? f.assets.characterDefaultOutfits.A
            : change === 'scope' ? f.appearanceScope : f.assets.wardrobe.A;
        const field = change === 'default' ? 'outfitName' : change === 'scope' ? 'owner' : 'prompt';
        const old = object[field]; object[field] = 'changed'; f.appearanceChanged();
        object[field] = old; f.appearanceChanged();
    }
    const rejected = await f.service.run(f.target, { preflightToken: ready.preflightToken });
    assert.equal(rejected.ok, false);
    assert.equal(rejected.stopGeneration, true);
    assert.equal(f.writes.length, 0); assert.equal(f.wires.length, 0);
    assert.equal(f.service.isBusy(), false); assert.equal(f.appearanceSubscriptions, 0);
    assert.deepEqual(await f.rawStore.getSlotRecord(f.before.key), f.before);
});


for (const mode of ['missing', 'read-error', 'decode-error', 'same-outfit', 'no-default'])
test(`衣装预检：图片状态-${mode}`, { timeout: 3000 }, async t => {
    let temporary = true;
    const f = await consistencyBuiltinFixture(1, undefined, mode === 'read-error'
        ? { readReferenceImage: async () => { if (temporary) throw new Error('read-failed');
            return { dataUrl: 'reference-A', type: 'sprite', revision: 1 }; } } : {});
    t.after(() => { f.service.cancel(); f.dispose(); });
    const originalPixels = f.pixels.get('reference-A'), decode = f.codec.decodeImage;
    if (mode === 'missing') f.pixels.delete('reference-A');
    if (mode === 'decode-error') f.codec.decodeImage = async () => { throw new Error('decode-failed'); };
    if (mode === 'no-default') {
        delete f.assets.characterDefaultOutfits.A;
        f.assets.characterOutfits.A.冬装.moods = {};
    }
    if (mode === 'same-outfit') f.assets.characterOutfits.A.冬装.moods.平和 = 'missing-reference';
    if (mode === 'same-outfit') f.assets.characterOutfits.A.冬装.moods.微笑 = 'reference-A';
    const pending = f.service.preflight(f.target);
    if (mode !== 'same-outfit') {
        await new Promise(resolve => setTimeout(resolve, 160));
        temporary = false; f.pixels.set('reference-A', originalPixels); f.codec.decodeImage = decode;
        f.assets.characterDefaultOutfits = structuredClone(f.originalAssets.characterDefaultOutfits);
        f.assets.characterOutfits = structuredClone(f.originalAssets.characterOutfits);
    }
    const ready = await pending;
    assert.equal(ready.ok, true, JSON.stringify(ready));
    assert.equal(ready.reason, 'ready');
    assert.deepEqual(ready.confirmations, []);
    f.service.cancel(ready.preflightToken);
    assert.equal(f.writes.length, 0); assert.equal(f.wires.length, 0);
    assert.equal(f.service.isBusy(), false); assert.equal(f.appearanceSubscriptions, 0);
    assert.deepEqual(await f.rawStore.getSlotRecord(f.before.key), f.before);
});


for (const change of ['image', 'wardrobe', 'scope']) test(`衣装预检：候选接受前复核-${change}`, async t => {
    const f = await consistencyBuiltinFixture(1);
    t.after(() => f.dispose());
    const candidate = await f.service.run(f.target);
    assert.equal(candidate.ok, true, JSON.stringify(candidate));
    if (change === 'image') f.referenceRevisions.set('reference-A', 2);
    else if (change === 'wardrobe') f.assets.wardrobe.A.prompt = 'changed';
    else f.appearanceScope.owner = 'other';
    const result = await f.service.accept(candidate.candidateId);
    assert.equal(result.reason, 'stale-appearance', JSON.stringify(result));
    assert.equal(result.stopGeneration, true);
    assert.equal(f.service.isBusy(), false); assert.equal(f.appearanceSubscriptions, 0);
    assert.deepEqual(await f.rawStore.getSlotRecord(f.before.key), f.before);
});

for (const phase of ['waitWrite', 'waitPaint']) test(`衣装预检：在途来源失效立即停止-${phase}`, async t => {
    const f = await consistencyBuiltinFixture(3, undefined, { [phase]: true });
    t.after(() => f.dispose());
    const pending = f.service.run(f.target);
    await waitBuiltinGate(f, phase === 'waitWrite' ? 3 : 1);
    const sent = f.wires.length;
    const old = f.assets.wardrobe.A.prompt;
    f.assets.wardrobe.A.prompt = 'changed'; f.appearanceChanged();
    f.assets.wardrobe.A.prompt = old; f.appearanceChanged();
    const result = await pending;
    assert.equal(result.reason, 'stale-appearance', JSON.stringify(result));
    assert.equal(result.stopGeneration, true);
    f.release();
    await new Promise(resolve => setTimeout(resolve, 30));
    assert.equal(f.wires.length, sent);
    assert.equal(f.service.isBusy(), false); assert.equal(f.appearanceSubscriptions, 0);
    assert.deepEqual(await f.rawStore.getSlotRecord(f.before.key), f.before);
});


for (const mode of ['exact', 'empty'])
test(`目标衣装契约：换衣采用保留原快照和永久身份-${mode}`, async t => {
    const { normalizeCharacterDna } = await import('../src/scene/character-dna.js');
    const f = await consistencyBuiltinFixture(1, undefined, { transformReply(reply) {
        return mode === 'empty'
            ? reply.replace(/^meta_outfit_description: 0 \|.*$/m, 'meta_outfit_description: 0 |') : reply;
    } });
    t.after(() => f.dispose());
    f.assets.characterOutfits.A.夏装 = { wardrobe: 'summer', moods: { 平和: 'reference-A' } };
    const description = 'wears a 1.2::light-blue cotton summer shirt:: with silver $& embroidery,';
    f.assets.wardrobe.summer = { prompt: description };
    f.assets.characterOutfits.A.冬装.moods = {};
    f.assets.characterDefaultOutfits.A.outfitName = '夏装';
    const assetsBefore = structuredClone(f.assets);
    const ready = await f.service.preflight(f.target);
    assert.equal(ready.reason, 'needs-confirmation');
    const candidate = await f.service.run(f.target, { preflightToken: ready.preflightToken, confirmed: true });
    assert.equal(candidate.ok, true, JSON.stringify(candidate));
    assert.equal(f.edits[0].characterMeta.characters[0].outfit.description, description);
    assert.ok(f.wires[0].parameters.v4_prompt.caption.char_captions[0].char_caption.includes(description),
        '冻结说明的权重、美元符号及尾逗号原样进入实际请求');
    assert.equal((await f.service.accept(candidate.candidateId)).ok, true);
    const saved = await f.rawStore.getSlotRecord(f.before.key);
    assert.deepEqual(saved.characterMeta, f.before.characterMeta);
    assert.deepEqual(saved.promptRecipe, f.before.promptRecipe);
    for (const round of saved.consistencyPrompt.rounds) {
        assert.equal(round.promptRecipe.identityMode, 'appearance_correction');
        assert.equal(round.outfitSnapshot.characters[0].name, '夏装');
        assert.equal(round.outfitSnapshot.characters[0].description, f.assets.wardrobe.summer.prompt);
        for (const identity of round.dnaSnapshot.characters) {
            assert.equal(identity.application, 'appearance_correction');
            assert.deepEqual(identity.profile, normalizeCharacterDna(f.assets.characterDna.A));
        }
    }
    assert.deepEqual(f.assets, assetsBefore);
});

for (const defect of ['outfit', 'token', 'duplicate', 'recursive', 'identity-mode', 'missing-identity-mode',
    'missing-reference-uc', 'empty-reference-identity', 'parallel-first-failure',
    'outfit-description', 'outfit-punctuation', 'missing-outfit-description'])
test(`目标衣装契约：非法回复零绘图-${defect}`, async t => {
    const reports = [];
    const parallel = defect === 'parallel-first-failure';
    let firstCanStart;
    const f = await consistencyBuiltinFixture(parallel ? 2 : 1, undefined, { report: (level, message) => reports.push({ level, message }),
        async transformReply(reply, input) {
        if (parallel) {
            if (input.promptTask.slots[0].slotId === 3)
                return reply.replace('char_uc: <<dna_uc:ref1>>\n', '');
            const deadline = Date.now() + 3000;
            while (firstCanStart() && Date.now() < deadline)
                await new Promise(resolve => setImmediate(resolve));
            assert.equal(firstCanStart(), false, '同组首错后停止其他分支交接');
            return reply;
        }
        if (defect === 'missing-reference-uc') return reply.replace('char_uc: <<dna_uc:ref0>>\n', '');
        if (defect === 'outfit-description')
            return reply.replace(/^meta_outfit_description: 0 \|.*$/m, 'meta_outfit_description: 0 | wears another coat');
        if (defect === 'outfit-punctuation')
            return reply.replace(/^(meta_outfit_description: 0 \|.*),$/m, '$1');
        if (defect === 'missing-outfit-description')
            return reply.replace(/^meta_outfit_description: 0 \|.*\n/m, '');
        if (defect === 'empty-reference-identity')
            return reply.replace('meta_correction_identity: 1 | new-A', 'meta_correction_identity: 1 |');
        if (defect === 'outfit') return reply.replace('meta_outfit_name: 0 | 冬装', 'meta_outfit_name: 0 | 错装');
        if (defect === 'token') return reply.replace('meta_token: 0 | actor0', 'meta_token: 0 | wrong');
        if (defect === 'duplicate') return reply + '\nmeta_key: 0 | A';
        if (defect === 'recursive') return reply.replace('meta_correction_identity: 0 | new-A', 'meta_correction_identity: 0 | <<dna:actor0>>');
        if (defect === 'missing-identity-mode') return reply.replace('identity_mode: appearance_correction\n', '');
        return reply.replace('identity_mode: appearance_correction', 'identity_mode: unknown');
    } });
    t.after(() => f.dispose());
    if (defect === 'outfit-punctuation') f.assets.wardrobe.A.prompt = 'wears a dark-navy cotton coat,';
    if (parallel) {
        const write = f.backend.writePrompt;
        f.backend.writePrompt = request => {
            if (request.promptTask.slots[0].slotId === 2) firstCanStart = request.shouldStart;
            return write(request);
        };
    }
    const result = await f.service.run(f.target);
    assert.equal(result.ok, false, JSON.stringify(result));
    assert.equal(f.wires.length, 0);
    if (['outfit-description', 'outfit-punctuation'].includes(defect)) {
        assert.equal(result.reason, 'OUTFIT_TEMPLATE_INVALID');
        assert.equal(result.diagnostics.field, 'outfit.description');
        assert.equal(result.diagnostics.issue, 'preserved');
    }
    if (parallel) {
        assert.equal(f.writes.length, 2);
        assert.equal(result.reason, 'DNA_TEMPLATE_BINDING');
        assert.equal(result.diagnostics.slotId, 3);
        assert.equal(result.diagnostics.field, 'char_uc');
        assert.equal(result.diagnostics.issue, 'mismatch');
        assert.doesNotMatch(JSON.stringify(reports), /stale-config/);
    }
    if (defect === 'missing-identity-mode') {
        assert.equal(result.diagnostics.field, 'promptRecipe.identityMode');
        assert.equal(result.diagnostics.issue, 'mismatch');
        assert.equal(result.diagnostics.expectedIdentityMode, 'appearance_correction');
        assert.equal(result.diagnostics.actualIdentityMode, 'absent');
        assert.ok(reports.some(row => /身份模式要求 appearance_correction，回复 absent/.test(row.message)));
    }
    assert.doesNotMatch(JSON.stringify(reports), /new-A|wrong-A|<<dna|fixture-builtin-key/);
    assert.deepEqual(await f.rawStore.getSlotRecord(f.before.key), f.before);
});

for (const [rw, rh] of [[16, 48], [48, 16]]) test(`完整参考几何：透明边与上下部-${rw}x${rh}`, async () => {
    const { planReferenceCanvas, buildReferencePixels } = await import('../src/media/cg-reference-canvas.js');
    const ref = { width: rw, height: rh, data: new Uint8ClampedArray(rw * rh * 4),
        referenceCrop: { x: 0, y: 0, width: rw, height: 1 } };
    for (let y = 2; y < rh - 2; y++) for (let x = 2; x < rw - 2; x++)
        ref.data.set(y < rh / 2 ? [255, 0, 0, 255] : [0, 0, 255, 255], (y * rw + x) * 4);
    const meta = { characters: [{ characterKey: 'A', region: { x: 0.1, y: 0.1, width: 0.7, height: 0.8 } }] };
    const plan = planReferenceCanvas(256, 128, meta, 'A', ref);
    assert.equal(plan.ok, true);
    const p = plan.referenceContent;
    assert.deepEqual(p.crop, { x: 2, y: 2, width: rw - 4, height: rh - 4 });
    assert.ok(Object.isFrozen(p) && Object.isFrozen(p.crop));
    assert.ok(Math.abs(p.width - p.crop.width * p.scale) < 1);
    assert.ok(Math.abs(p.height - p.crop.height * p.scale) < 1);
    assert.ok(p.x >= plan.reference.x && p.x + p.width <= plan.size.width);
    assert.ok(p.y >= 0 && p.y + p.height <= plan.size.height);
    const source = { width: 256, height: 128, data: new Uint8ClampedArray(256 * 128 * 4).fill(255) };
    const built = buildReferencePixels(source, ref, plan);
    const x = p.x + Math.floor(p.width / 2);
    for (const [y, color] of [[p.y, [255, 0, 0, 255]], [p.y + p.height - 1, [0, 0, 255, 255]]]) {
        const at = (y * plan.size.width + x) * 4;
        assert.deepEqual([...built.image.data.subarray(at, at + 4)], color);
    }
    for (let y = 0; y < plan.size.height; y++) for (let x = plan.reference.x; x < plan.size.width; x++)
        assert.equal(built.mask.data[(y * plan.size.width + x) * 4], 0);
    assert.ok(plan.size.width * plan.size.height <= 1024 * 1024);
    assert.equal(plan.size.width % 64 + plan.size.height % 64, 0);
    const empty = { ...ref, data: new Uint8ClampedArray(ref.data.length) };
    assert.equal(planReferenceCanvas(256, 128, meta, 'A', empty).ok, false);
});


test('无关资料并行保存：一致性只跟踪本图衣装与参考，忽略其它别名衣柜及楼层通知', async t => {
    const f = await consistencyBuiltinFixture(1);
    t.after(() => f.dispose());
    const ready = await f.service.preflight(f.target);
    assert.equal(ready.reason, 'ready', JSON.stringify(ready));
    f.assets.characterAliases = { Other: ['alias'] };
    f.assets.wardrobe = { ...f.assets.wardrobe, Other: { prompt: 'red dress' } };
    f.assets.characterOutfits.A.夏装 = { wardrobe: 'Other', moods: { 平和: 'other-reference' } };
    f.assets.characterOutfits.A.冬装.note = '管理备注';
    f.assets.characterOutfits.A.冬装.moods.喜悦 = 'other-expression';
    f.assets.characterDefaultOutfits.A.outfitName = '夏装';
    f.appearanceChanged({ targetChanged: true });
    const candidate = await f.service.run(f.target, { preflightToken: ready.preflightToken });
    assert.equal(candidate.ok, true, JSON.stringify(candidate));
    assert.equal(f.wires.length, 1);
    const result = await f.service.accept(candidate.candidateId);
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(f.assets.characterDefaultOutfits.A.outfitName, '夏装');
    assert.equal(f.assets.wardrobe.Other.prompt, 'red dress');
});

test('自动恢复：接受 CG 时存储中断和修订推进，续存同一候选并保留其它字段', async () => {
    const f = await consistencyFixture();
    const candidate = await f.service.redrawConsistency(f.query);
    assert.equal(candidate.ok, true, JSON.stringify(candidate));
    const paintCount = f.calls.length;
    const update = f.store.updateSlot.bind(f.store);
    let attempts = 0;
    f.store.updateSlot = async (...args) => {
        attempts++;
        if (attempts === 1) throw new Error('temporary-storage');
        if (attempts === 2) {
            const current = await f.store.getSlotRecord(f.before.key);
            await f.store.putSlot(f.key, { ...current, userNote: 'saved-during-accept' });
            return { ok: false, reason: 'stale-revision' };
        }
        return update(...args);
    };
    const result = await f.service.acceptConsistency(candidate.candidateId);
    assert.equal(result.ok, true, JSON.stringify(result));
    const saved = await f.store.getSlotRecord(f.before.key);
    assert.equal(saved.dataUrl, candidate.dataUrl);
    assert.equal(saved.userNote, 'saved-during-accept');
    assert.equal(f.calls.length, paintCount);
    assert.equal(attempts, 3);
});

test('自动恢复：一致性一位角色出图失败后续画，完成的另一位角色不重复出图', async () => {
    const f = await consistencyFixture();
    const edit = f.backend.edit.bind(f.backend), calls = new Map();
    f.backend.edit = async request => {
        const key = request.slotId;
        calls.set(key, (calls.get(key) || 0) + 1);
        if (key === 2 && calls.get(key) === 1) return { ok: false, reason: 'edit-failed' };
        return edit(request);
    };
    const candidate = await f.service.redrawConsistency(f.query);
    assert.equal(candidate.ok, true, JSON.stringify(candidate));
    assert.equal(calls.get(2), 2);
    assert.equal(calls.get(3), 1);
    assert.equal((await f.service.acceptConsistency(candidate.candidateId)).ok, true);
});
