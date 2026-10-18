import test from 'node:test';
import assert from 'node:assert/strict';
import { recoverOperation, createOperationCheckpoint, checkpointService, wakeRecoveringOperations, subscribeRecoveries } from '../src/storage/automatic-recovery.js';
import { mediaRequest } from '../src/media/tavern-media-http.js';
import { createArchiveDownload } from '../src/media/archive-download.js';
import { createIdbConnection } from '../src/media/idb-connection.js';
import { createTransactionalIdb } from './helpers/transactional-idb.js';
import { createAssetRecordCache } from '../src/media/asset-record-cache.js';
import { fixtureMedia } from './helpers/media-fixtures.js';

test('地图恢复：上传后的保存和删除分别失败，续存原文件并依次完成同位置写入', async t => {
    const { fakeMediaServer, pixel } = await import('./helpers/fake-media-server.js');
    const { createMediaRuntime } = await import('../src/media/media-runtime.js');
    const { mapImageRepositoryFor } = await import('../src/media/tavern-map-images.js');
    const server = fakeMediaServer(), global = server.host();
    const media = createMediaRuntime(global);
    t.after(() => media.destroy());
    const repository = mapImageRepositoryFor(global), key = 'igs-map-custom:chat:table:level';
    let uploads = 0, saveFault = true, deleteFault = true;
    const fetch = global.fetch, set = global.localStorage.setItem.bind(global.localStorage), remove = global.localStorage.removeItem.bind(global.localStorage);
    global.fetch = (...args) => { if (args[0] === '/api/images/upload') uploads++; return fetch(...args); };
    global.localStorage.setItem = (name, value) => {
        if (name === key && saveFault) { saveFault = false; throw new Error('temporary-save'); }
        return set(name, value);
    };
    global.localStorage.removeItem = name => {
        if (name === key && deleteFault) { deleteFault = false; throw new Error('temporary-remove'); }
        return remove(name);
    };
    assert.equal((await repository.set(key, pixel('same-upload'))).ok, true);
    assert.equal(uploads, 1);
    assert.equal(server.images.get(global.localStorage.getItem(key)), pixel('same-upload'));
    const first = repository.set(key, 'https://example.invalid/first.webp');
    const second = repository.set(key, 'https://example.invalid/second.webp');
    assert.equal((await first).ok, true);
    assert.equal((await second).ok, true);
    assert.equal(global.localStorage.getItem(key), 'https://example.invalid/second.webp');
    assert.equal((await repository.remove(key)).ok, true);
    assert.equal(global.localStorage.getItem(key), null);
});

test('字体恢复：已选文件只上传一次，清单保存恢复后才报告完成和删除服务端文件', async () => {
    const { handleSettingsAction } = await import('../src/visual/igs-ui/settings-actions.js');
    const { CUSTOM_FONT_STORE_KEY, loadCustomFonts } = await import('../src/media/custom-fonts.js');
    const { createMemoryStorage } = await import('../src/storage/preset-store.js');
    const localStorage = createMemoryStorage(), set = localStorage.setItem;
    const file = { name: 'fixture.woff2', size: 3, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer };
    let selected = 0, uploads = 0, deletes = 0, failSave = true;
    localStorage.setItem = (key, value) => {
        if (key === CUSTOM_FONT_STORE_KEY && failSave) { failSave = false; throw new Error('temporary-list-save'); }
        return set(key, value);
    };
    const global = { localStorage, document: { createElement() { return { click() { selected++; this.files = [file]; this.onchange(); } }; } },
        SillyTavern: { getContext: () => ({ getRequestHeaders: () => ({ 'Content-Type': 'application/json' }) }) },
        fetch: async (url, options) => {
            if (url === '/api/files/upload') { uploads++; return { ok: true, json: async () => ({ path: `user/files/${JSON.parse(options.body).name}` }) }; }
            assert.equal(url, '/api/files/delete');
            assert.deepEqual(loadCustomFonts(global), [], '清单持久化成功后才删除文件');
            deletes++; return { ok: true };
        } };
    const context = { state: { activeSettings: { draft: { readerSettings: {}, bridge: {} }, asyncState: {} } },
        options: { global, recoveryCheckpoint: createOperationCheckpoint() },
        persistSettingsDraft: () => ({ ok: true }), rerenderSettings: () => ({ ok: true }),
        dialogs: { confirm: async () => true }, closeSettings() {}, buildRegexPreview() {} };
    assert.equal((await handleSettingsAction('custom-font-upload', context)).ok, true);
    const [font] = loadCustomFonts(global);
    assert.ok(font);
    assert.deepEqual([selected, uploads], [1, 1]);
    failSave = true;
    assert.equal((await handleSettingsAction(`custom-font-remove:${font.id}`, context)).ok, true);
    assert.equal(deletes, 1);
});

test('CG库恢复：拍照不重复合成，收藏和删除成功后仅续做失败的目录步骤', async t => {
    const { createCgLibrary } = await import('../src/media/cg-library.js');
    const { createMemoryPhotoAlbumStore } = await import('../src/media/photo-album.js');
    const { createMemoryCgIndexStore } = await import('../src/media/cg-index-store.js');
    const media = fixtureMedia(); t.after(() => media.destroy());
    const raw = createMemoryPhotoAlbumStore(), index = createMemoryCgIndexStore({ mediaCache: media });
    let compositions = 0, ids = 0, writes = 0, patches = 0, removals = 0, indexWrites = 0, indexPatches = 0, indexRemovals = 0;
    const photos = { ...raw,
        async put(photo) { writes++; if (writes === 1) throw new Error('temporary-photo-save'); return raw.put(photo); },
        async patchMetadata(id, patch) { patches++; const photo = await raw.get(id); return raw.put({ ...photo, ...patch }); },
        async remove(id) { removals++; return raw.remove(id); } };
    const library = createCgLibrary({ mediaCache: media, photoStore: photos,
        indexStore: { ...index,
            async putMany(rows) { indexWrites++; if (indexWrites === 1) throw new Error('temporary-index-save'); return index.putMany(rows); },
            async patch(...args) { indexPatches++; if (indexPatches === 1) throw new Error('temporary-index-patch'); return index.patch(...args); },
            async removeMany(...args) { indexRemovals++; if (indexRemovals === 1) throw new Error('temporary-index-remove'); return index.removeMany(...args); } },
        compose: async () => { compositions++; return 'data:image/jpeg;base64,AAAA'; }, makeId: () => `photo-${++ids}` });
    assert.equal((await library.capturePhoto({ chatId: 'chat', messageId: 1 })).ok, true);
    assert.deepEqual([compositions, ids, writes, indexWrites], [1, 1, 2, 2]);
    const [entry] = (await library.readIndex()).entries;
    assert.equal((await library.setFavorite(entry, true)).ok, true);
    assert.deepEqual([patches, indexPatches], [1, 2]);
    assert.equal((await raw.get('photo-1')).favorite, true);
    assert.equal((await library.remove(entry)).ok, true);
    assert.deepEqual([removals, indexRemovals], [1, 2]);
    assert.deepEqual(await index.getAll(), []);
});

test('媒体目录恢复：关闭能结束目录故障等待，重新启动后从已保存记录同步', async t => {
    const { fakeMediaServer } = await import('./helpers/fake-media-server.js');
    const { createMediaRuntime } = await import('../src/media/media-runtime.js');
    const { createMemoryIllustrationStore } = await import('../src/media/illustration-store.js');
    const { createMemoryCgIndexStore } = await import('../src/media/cg-index-store.js');
    const { withCgIndexSync } = await import('../src/media/cg-library.js');
    const global = fakeMediaServer().host(), raw = createMemoryIllustrationStore();
    let runtime = createMediaRuntime(global), failed = true, entered;
    t.after(() => runtime.destroy());
    const started = new Promise(resolve => { entered = resolve; });
    const rows = new Map();
    const index = { async upsert(entries) {
        if (failed) { entered(); throw new Error('temporary-index-unavailable'); }
        for (const entry of entries) rows.set(entry.key, entry);
    } };
    const first = withCgIndexSync(raw, index, global);
    const pending = first.putSlot('chat|1|0', { slot: 1, status: 'done', dataUrl: 'data:image/png;base64,AAAA' });
    await started;
    await runtime.destroy();
    await pending;
    assert.equal((await raw.getSlotRecord('chat|1|0|1')).dataUrl, 'data:image/png;base64,AAAA');
    assert.equal(rows.size, 0);
    runtime = createMediaRuntime(global); failed = false;
    const catalog = createMemoryCgIndexStore({ mediaCache: runtime.cache });
    const { createCgLibrary } = await import('../src/media/cg-library.js');
    const library = createCgLibrary({ globalObject: global, mediaCache: runtime.cache, illustrationStore: raw, indexStore: catalog });
    assert.equal((await library.syncIndex()).ok, true);
    assert.equal((await catalog.getAll())[0].ready, true);
});

test('局部重绘恢复：失败请求自动接续，抠图和保存失败复用已生成候选', async () => {
    const { createInpaintTransaction } = await import('../src/generated-images/illustration/inpaint-transaction.js');
    let reads = 0, paints = 0, mattes = 0, saves = 0;
    const requests = [], patches = [];
    const tx = createInpaintTransaction({
        service: { async getEditableImage() { reads++; return { ok: true, editable: true, record: { revision: 1, originalDataUrl: 'original' } }; },
            async saveMatteEdit(_id, _revision, patch) { saves++; patches.push(patch); return saves === 1 ? { ok: false, reason: 'write-failed' } : { ok: true, revision: 2 }; } },
        backend: { describeEdit: () => ({ supported: true }), async edit(request) {
            paints++; requests.push(request); return paints === 1 ? { ok: false, reason: 'temporary-provider-error' } : { ok: true, dataUrl: 'candidate' }; } },
        matte: async () => { mattes++; return mattes === 1 ? '' : { dataUrl: 'cut', alphaMaskDataUrl: 'mask' }; },
    });
    assert.equal((await tx.preview('sprite', { maskDataUrl: 'selection', prompt: 'fix' })).ok, true);
    assert.equal((await tx.accept()).ok, true);
    assert.deepEqual([reads, paints, mattes, saves], [1, 2, 2, 2]);
    assert.deepEqual(requests[0], requests[1]);
    assert.deepEqual(patches[0], patches[1]);
    assert.equal(tx.hasCandidate(), false);
});

test('恢复原操作：解除实际存储故障后续存，生成及输入步骤只执行一次', async () => {
    const checkpoint = createOperationCheckpoint();
    let generations = 0, inputCount = 0, saves = 0, writable = false;
    const service = checkpointService({ async generateCharacterSprite() { generations++; return { ok: true, imageId: 'existing-image' }; } }, checkpoint);
    const result = await recoverOperation(async () => {
        const input = await checkpoint.step('input', async () => { inputCount++; return 'Alice'; });
        const generated = await service.generateCharacterSprite({ name: input });
        saves++;
        if (!writable) return { ok: false, reason: 'save-failed' };
        return { ok: true, imageId: generated.imageId };
    }, { wait: async () => {}, repair() { writable = true; return { changed: true }; } });
    assert.equal(result.imageId, 'existing-image');
    assert.deepEqual([generations, inputCount, saves], [1, 1, 2]);
});

test('无进展恢复：错误措辞变化不会持续循环，条件解除后续接原操作', async t => {
    const controller = new AbortController(), global = {};
    t.after(() => controller.abort());
    let calls = 0, writable = false, waiting;
    const stalled = new Promise(resolve => { waiting = resolve; });
    const pending = recoverOperation(() => {
        calls++;
        return writable ? { ok: true, value: 'kept' } : { ok: false, reason: `same-failure-${calls}` };
    }, { global, signal: controller.signal, wait: async () => {},
        waitFor: { message: '存储暂不可写，恢复后自动续存。' }, canResume: () => writable,
        onRecover({ phase }) {
        if (phase === 'waiting-condition') waiting();
    } });
    await stalled;
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(calls, 2);
    writable = true;
    wakeRecoveringOperations(global);
    assert.deepEqual(await pending, { ok: true, value: 'kept' });
    assert.equal(calls, 3);
});

test('请求续接：没有新的凭据依据时不重复发送，修复凭据后完成原任务', async t => {
    const controller = new AbortController(), global = {};
    t.after(() => controller.abort());
    let calls = 0, key = 'expired', captured = key, waiting;
    const stalled = new Promise(resolve => { waiting = resolve; });
    const pending = recoverOperation(() => {
        calls++;
        return captured === 'valid' ? { ok: true, image: 'original-request-result' } : { ok: false, reason: 'authentication-failed' };
    }, { global, signal: controller.signal, retryUnchanged: false,
        waitFor: { message: '凭据已失效，保存新凭据后自动继续。', page: 'source' },
        canResume() { const changed = captured !== key; captured = key; return changed; },
        onRecover({ phase }) { if (phase === 'waiting-condition') waiting(); } });
    await stalled;
    assert.equal(calls, 1);
    wakeRecoveringOperations(global);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(calls, 1, '无关通知不是重复请求的依据');
    key = 'valid'; wakeRecoveringOperations(global);
    assert.equal((await pending).ok, true);
    assert.equal(calls, 2);
});

test('没有续接条件的失败明确结束，外层不会再次请求或挂起', async () => {
    const global = {}, snapshots = [];
    const off = subscribeRecoveries(global, entries => snapshots.push(entries));
    let calls = 0;
    const inner = () => recoverOperation(() => {
        calls++; return { ok: false, reason: 'provider-unavailable', error: '插件出图失败' };
    }, { global, retryUnchanged: false, canResume: () => false });
    const result = await recoverOperation(inner, { global });
    assert.equal(result.ok, false);
    assert.equal(result.recoveryStopped, true);
    assert.equal(calls, 1);
    const entries = snapshots.at(-1);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].phase, 'failed');
    assert.equal(entries[0].message, '插件出图失败');
    entries[0].dismiss();
    assert.deepEqual(snapshots.at(-1), []);
    off();
});

test('保存持续失败时主动续存并显示原因，恢复后复用原图片完成', async () => {
    const global = {}, snapshots = [];
    const off = subscribeRecoveries(global, entries => snapshots.push(entries));
    let calls = 0;
    const result = await recoverOperation(() => {
        calls++;
        if (calls < 4) throw Object.assign(new Error('浏览器存储空间不足'), { name: 'QuotaExceededError', code: 22 });
        return { ok: true, image: 'original' };
    }, { global, repeatable: 'save', wait: async () => {} });
    assert.equal(result.image, 'original');
    assert.equal(calls, 4);
    assert.ok(snapshots.some(entries => entries.some(entry => entry.page === 'data' && /存储空间不足.*续存原结果/.test(entry.message))));
    assert.deepEqual(snapshots.at(-1), []);
    off();
});

test('媒体请求：响应头错误及响应体损坏后原请求自动恢复', async () => {
    let requests = 0;
    const response = await mediaRequest({ fetch: async () => {
        requests++;
        return requests === 1 ? new Response('', { status: 503 })
            : new Response(requests === 2 ? '{broken' : '{"value":42}');
    } }, '/user/files/fixture.json');
    assert.deepEqual(await response.json(), { value: 42 });
    assert.equal(requests, 3);
});

test('媒体写入恢复：上传或删除响应丢失时读回确认，每项只发送一次写请求', { timeout: 3000 }, async () => {
    for (const mode of ['image-upload', 'file-upload', 'delete']) {
        const { fakeMediaServer, pixel } = await import('./helpers/fake-media-server.js');
        const server = fakeMediaServer(), global = server.host(), fetch = global.fetch;
        const data = pixel('saved-on-server');
        const path = mode === 'file-upload' ? 'user/files/receipt.json' : 'user/images/igs-media/receipt.png';
        let writes = 0;
        if (mode === 'delete') server.images.set(path, data);
        global.fetch = async (url, options) => {
            const response = await fetch(url, options);
            if (url.startsWith('/api/') && url !== '/api/images/list') {
                writes++;
                if (mode === 'file-upload') throw new Error('response-lost-after-save');
                return { ...response, json: async () => { throw new Error('response-body-lost'); } };
            }
            return response;
        };
        const endpoint = mode === 'file-upload' ? '/api/files/upload' : mode === 'delete' ? '/api/images/delete' : '/api/images/upload';
        const body = mode === 'file-upload' ? { name: 'receipt.json', data: Buffer.from('{"saved":true}').toString('base64') }
            : mode === 'delete' ? { path } : { image: data.split(',')[1], ch_name: 'igs-media', filename: 'receipt', format: 'png' };
        const response = await mediaRequest(global, endpoint, { method: 'POST', body: JSON.stringify(body) });
        assert.equal(response.ok, true);
        assert.deepEqual(await response.json(), { path });
        assert.equal(writes, 1);
        if (mode === 'delete') assert.equal(server.images.has(path), false);
    }
});

test('导出恢复：写入与关闭分别中断，保留同一文件并逐块重放完整内容', async () => {
    let pickCount = 0, writeFault = true, closeFault = true, committed;
    const file = { async createWritable() {
        const chunks = [];
        return { async write(bytes) {
            if (writeFault && bytes[0] === 3) { writeFault = false; throw new Error('temporary-write-failure'); }
            chunks.push(new Uint8Array(bytes));
        }, async close() {
            if (closeFault) { closeFault = false; throw new Error('temporary-close-failure'); }
            committed = Uint8Array.from(chunks.flatMap(bytes => [...bytes]));
        }, async abort() {} };
    } };
    const sink = await createArchiveDownload({ async showSaveFilePicker() { pickCount++; return file; } }, 'fixture.zip');
    await sink.write(new Uint8Array([1, 2]));
    await sink.write(new Uint8Array([3, 4]));
    await sink.write(new Uint8Array([5]));
    await sink.close();
    assert.deepEqual([...committed], [1, 2, 3, 4, 5]);
    assert.equal(pickCount, 1);
});

test('数据库恢复：失效连接自动重开并完成原事务', async () => {
    const indexedDB = createTransactionalIdb();
    let fail = true, opens = 0;
    const connection = createIdbConnection({ open(...args) {
        opens++;
        const request = indexedDB.open(...args);
        let callback;
        Object.defineProperty(request, 'onsuccess', { get: () => callback, set(fn) {
            callback = event => {
                const db = request.result, transaction = db.transaction.bind(db);
                db.transaction = (...txArgs) => {
                    if (fail) { fail = false; throw Object.assign(new Error('database closed'), { name: 'InvalidStateError' }); }
                    return transaction(...txArgs);
                };
                fn(event);
            };
        } });
        return request;
    } }, 'recovery-fixture', 1, db => db.createObjectStore('rows', { keyPath: 'id' }));
    await connection.transact('rows', 'readwrite', tx => tx.objectStore('rows').put({ id: 'saved', value: 42 }));
    assert.equal((await connection.transact('rows', 'readonly', tx => tx.objectStore('rows').get('saved'))).value, 42);
    assert.ok(opens >= 2);
    await connection.close();
});

test('数据库恢复：blocked及慢事务保留同一次结果，关闭后清理迟到连接', { timeout: 3000 }, async () => {
    const requests = [], transactions = [];
    let opens = 0, closes = 0;
    const database = { close() { closes++; }, transaction() { const tx = {}; transactions.push(tx); return tx; } };
    const connection = createIdbConnection({ open() {
        opens++; const request = { result: database }; requests.push(request);
        queueMicrotask(() => request.onblocked?.()); return request;
    } }, 'slow-recovery', 1, null, { openTimeoutMs: 5 });
    let finished = false;
    const pending = connection.transact('records', 'readonly', () => () => 'original-result', { timeoutMs: 5 })
        .then(value => { finished = true; return value; });
    await new Promise(resolve => setTimeout(resolve, 15));
    assert.equal(finished, false); assert.equal(opens, 1);
    requests[0].onsuccess();
    await new Promise(resolve => setTimeout(resolve, 15));
    assert.equal(finished, false); assert.equal(transactions.length, 1);
    transactions[0].oncomplete();
    assert.equal(await pending, 'original-result');
    await connection.close();
    const late = connection.open();
    const rejected = assert.rejects(late, /media-stopped/);
    await connection.close(); await rejected;
    requests[1].onsuccess();
    assert.equal(closes, 2);
});

test('宿主发送恢复：消息已发送但回执迟到时只读取原消息，正文只发送一次', { timeout: 3000 }, async () => {
    const { createTavernHelperAdapter } = await import('../src/host/tavern-helper-adapter.js');
    const chat = [];
    let sends = 0;
    const global = { SillyTavern: { getContext: () => ({ chat, chatId: 'chat' }) },
        TavernHelper: { async typeAndSend(text) {
            sends++;
            setTimeout(() => chat.push({ is_user: true, mes: text }), 50);
            throw new Error('receipt-lost');
        } } };
    const result = await createTavernHelperAdapter(global).typeAndSend('原输入');
    assert.equal(result.ok, true); assert.equal(sends, 1);
    assert.equal(chat.length, 1); assert.equal(chat[0].mes, '原输入');
});

test('素材记录恢复：缓存版本推进后自动读取最新记录，不要求重新读取', async t => {
    const media = fixtureMedia();
    let reads = 0, release, entered;
    const started = new Promise(resolve => { entered = resolve; });
    const held = new Promise(resolve => { release = resolve; });
    const cache = createAssetRecordCache({ mediaCache: media, owner: 'asset-records', store: {
        async getAsset(key) {
            reads++;
            if (reads === 1) { entered(); await held; }
            return { key, chatId: 'chat', type: 'sprite', name: 'Alice', imageId: 'kept', status: 'review' };
        },
    } });
    t.after(() => { cache.destroy(); media.destroy?.(); });
    const pending = cache.read('chat', 'record');
    await started;
    cache.remember({ key: 'other', chatId: 'chat', type: 'background' });
    release();
    const result = await pending;
    assert.equal(result.imageId, 'kept');
    assert.equal(reads, 2);
});


test('实际设置控制器：生成完成后保存失败，自动保存同一张图且不重复询问', async t => {
    const { bootstrapIGS } = await import('../src/index.js');
    const { builtinImageHarness } = await import('./helpers/builtin-image-harness.js');
    const { createMemoryStorage } = await import('../src/storage/preset-store.js');
    const { createMemoryGeneratedAssetStore } = await import('../src/media/generated-asset-store.js');
    const { createMemoryIllustrationStore } = await import('../src/media/illustration-store.js');
    const { pngFixture } = await import('./helpers/png-fixture.js');
    const h = builtinImageHarness();
    const storage = createMemoryStorage(), setItem = storage.setItem;
    let failSave = false, saveFaults = 0, paints = 0, prompts = 0, confirms = 0;
    storage.setItem = (key, value) => {
        if (failSave && key === 'igs_bridge_config') { failSave = false; saveFaults++; throw new Error('temporary-settings-write'); }
        return setItem(key, value);
    };
    const global = { localStorage: storage, btoa, confirm() { confirms++; return true; }, prompt() { prompts++; return ''; }, alert() {},
        SillyTavern: { getContext: () => ({ extensionPrompts: {}, getWorldInfoPrompt: async () => ({ worldInfoString: '' }) }) } };
    const vn = bootstrapIGS({ global, storage, config: { ...h.bridge,
        sceneAssets: { enabled: true, characters: { Alice: {} }, characterDna: {}, scenes: {} } },
        secondaryLlm: h.llm, generatedAssetStore: createMemoryGeneratedAssetStore(),
        illustrationStore: createMemoryIllustrationStore(), autoAttachMagicWand: false,
        alphaMatte: async value => value,
        illustrationMessageHost: { getChatId: () => 'settings-recovery', readFloor: () => null,
            readPreviousAiTexts: () => [], readCharacterLore: async () => [], on: () => () => {},
            onImageFloorReady: () => () => {}, destroy() {}, attachPromptStrip() {}, ensureMarkerRegexes: async () => ({ ok: true }) },
        hostAdapter: { getCurrentMessage: async () => null, typeAndSend: async () => ({ ok: true }) },
        async fetch(_url, init) {
            paints++; failSave = true;
            const body = JSON.parse(init.body);
            return new Response(pngFixture(body.parameters.width, body.parameters.height).bytes,
                { headers: { 'Content-Type': 'image/png' } });
        },
    });
    t.after(async () => { h.dispose(); await vn.shutdown(); });
    const opened = vn.openSettings({ page: 'characters' });
    const result = await opened.controller.invoke('char-generate-sprite:Alice');
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.deepEqual([paints, saveFaults, prompts, confirms], [1, 1, 1, 1]);
    const assets = vn.getUnifiedSettings().bridge.sceneAssets;
    assert.ok(Object.values(assets.characterOutfits.Alice).some(outfit => outfit.moods?.平和?.startsWith('igs-gen:')));
});

test('物品图恢复：素材记录保存中断，原图片和写词结果保留并自动完成', async t => {
    const { createItemImageService } = await import('./helpers/media-fixtures.js');
    const { createMemoryGeneratedAssetStore } = await import('../src/media/generated-asset-store.js');
    const store = createMemoryGeneratedAssetStore();
    const put = store.putAsset.bind(store);
    let paints = 0, saves = 0;
    store.putAsset = async record => {
        saves++;
        if (saves === 1) throw new Error('temporary-asset-write');
        return put(record);
    };
    const service = createItemImageService({ store, llm: {},
        messageHost: { getChatId: () => 'item-recovery', readFloor: () => null, on: () => () => {} },
        nai: { describe: () => ({ mode: 'dbgen', ownPrompts: true, ready: { ok: true } }),
            async generate() { paints++; return { ok: true, dataUrl: 'data:image/png;base64,aXRlbQ==' }; } },
        getSettings: () => ({ itemImages: { enabled: true } }), matte: async value => value,
    });
    t.after(() => service.stop());
    const result = await service.regenerate('book');
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.deepEqual([paints, saves], [1, 2]);
});

test('故事回复恢复：继续宿主原回复，不重复发送用户正文', async () => {
    const { createTavernHelperAdapter } = await import('../src/host/tavern-helper-adapter.js');
    const chat = [{ is_user: true, mes: '原输入' }, { is_user: false, mes: '已经收到的正文' }];
    const calls = [];
    const adapter = createTavernHelperAdapter({ SillyTavern: { getContext: () => ({ chat,
        generate: async kind => calls.push(kind) }) } });
    assert.equal((await adapter.resumeReply()).ok, true);
    chat.at(-1).mes = '';
    assert.equal((await adapter.resumeReply()).ok, true);
    chat.pop();
    assert.equal((await adapter.resumeReply()).ok, true);
    assert.deepEqual(calls, ['continue', 'regenerate', 'normal']);
    assert.deepEqual(chat, [{ is_user: true, mes: '原输入' }]);
});

test('参考资料恢复：两人只准备一次 DNA，按各自同名衣装补图，保存失败自动续存', async () => {
    const { createCharacterReferenceRecovery } = await import('../src/core/character-reference-recovery.js');
    let root = { characters: { A: {}, B: {} }, characterDna: {}, wardrobe: {}, characterOutfits: {} };
    let dnaRequests = 0, saves = 0;
    const generated = [];
    const prepare = async () => ({ ok: true });
    prepare.batch = async request => { dnaRequests++; assert.deepEqual(request.characters.map(c => c.name), ['A', 'B']); return { ok: true }; };
    const service = { prepareExternalSpriteDna: prepare,
        async generateExpressionImage(request) {
            generated.push([request.name, request.outfit.name]);
            const saved = await request.onOutfitDna({ name: request.outfit.name, description: request.outfit.prompt });
            assert.equal(saved.ok, true);
            return { ok: true, items: [{ ok: true, imageId: `ref-${request.name}` }] };
        } };
    const repair = createCharacterReferenceRecovery({ readAssets: () => root, readContext: () => null,
        getService: () => service, saveAssets(next) {
            saves++;
            if (saves === 1) return { ok: false, reason: 'temporary-save' };
            root = next; return { ok: true };
        } });
    const result = await repair({ characters: ['A', 'B'].map(characterKey => ({ characterKey })),
        record: { characterMeta: { characters: ['A', 'B'].map(characterKey => ({ characterKey,
            outfit: { name: '红裙', description: 'red dress' } })) } }, shouldStart: () => true });
    assert.equal(result.ok, true);
    assert.equal(dnaRequests, 1);
    assert.deepEqual(generated, [['A', '红裙'], ['B', '红裙']]);
    assert.equal(root.characterOutfits.A.红裙.moods.平和, 'igs-gen:ref-A');
    assert.equal(root.characterOutfits.B.红裙.moods.平和, 'igs-gen:ref-B');
    assert.notEqual(root.characterOutfits.A.红裙.wardrobe, root.characterOutfits.B.红裙.wardrobe);
});

test('媒体生命周期恢复：关闭中止挂起的请求，重新启动后可正常读取', async () => {
    const { startMediaRequests, stopMediaRequests } = await import('../src/media/tavern-media-http.js');
    let entered;
    const started = new Promise(resolve => { entered = resolve; });
    const global = { fetch: async () => { entered(); return new Promise(() => {}); } };
    const pending = mediaRequest(global, '/fixture-hanging');
    await started;
    stopMediaRequests(global);
    await assert.rejects(pending, /media-request-aborted/);
    startMediaRequests(global);
    global.fetch = async () => new Response('{"restored":true}');
    assert.deepEqual(await (await mediaRequest(global, '/fixture-hanging')).json(), { restored: true });
    stopMediaRequests(global);
});
