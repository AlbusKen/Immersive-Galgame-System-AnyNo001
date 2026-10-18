import test from 'node:test';
import assert from 'node:assert/strict';
import { createLocalImageCache, localImageCacheFor } from '../src/media/tavern-image-cache.js';
import { createTavernImageFiles } from '../src/media/tavern-image-files.js';
import { createMemoryGeneratedAssetStore } from '../src/media/generated-asset-store.js';
import { withTavernGeneratedAssetFiles } from '../src/media/tavern-generated-assets.js';
import { exportAssetArchive, readAssetArchive } from '../src/scene/asset-archive.js';
import { snapshotAssetLibrary } from '../src/scene/asset-scope.js';
import { buildCharacterCardPack, parseCharacterCardPack } from '../src/scene/card-pack.js';
import { prepareImageImport } from '../src/media/image-import-transaction.js';
import { readZip, writeZip } from '../src/media/archive-zip.js';
import { createMemoryImageCacheStore } from '../src/media/image-cache-store.js';
import { normalizeBridgeConfig } from '../src/visual/igs-ui/settings-host-normalize.js';
import { fakeMediaServer, pixel } from './helpers/fake-media-server.js';

function sink() {
    const parts = [];
    return { mode: 'fixture', parts, closed: false, aborted: false,
        async write(bytes) { parts.push(bytes.slice()); }, async close() { this.closed = true; }, async abort() { this.aborted = true; },
        blob() { return new Blob(parts, { type: 'application/zip' }); } };
}

test('显示字节转码后再入缓存，未接纳时也不返回原像素，清缓存拒收迟到编码', async () => {
    const original = pixel('original-uncompressed'.repeat(100)), display = 'data:image/webp;base64,V0VCUA==';
    let release, started;
    const began = new Promise(resolve => { started = resolve; });
    const gate = new Promise(resolve => { release = resolve; });
    const encoder = {
        accepts: value => value === original,
        async encode(value) { if (value !== original) return value; started(); await gate; return display; },
    };
    const cache = createLocalImageCache({ atob, btoa, Blob, URL }, { displayEncoder: encoder, compressDisplay: true });
    const task = cache.load('asset:a', async () => original);
    await began;
    assert.equal((await cache.stats()).memoryCount, 0);
    await cache.clear(); release(); assert.equal(await task, '');
    assert.equal(cache.peek('asset:a'), '');
    assert.equal(await cache.load('asset:a', async () => original), display);
    assert.match(cache.peek('asset:a'), /^blob:/);
    assert.equal(await cache.get('asset:a'), display);
    assert.ok((await cache.stats()).memoryBytes < original.length);
    await cache.destroy();
    const tiny = createLocalImageCache({ atob, btoa, Blob, URL }, { memoryBytes: 0, displayEncoder: encoder, compressDisplay: true });
    assert.equal(await tiny.load('asset:a', async () => original), display);
    assert.equal((await tiny.stats()).memoryCount, 0); await tiny.destroy();
});

test('导出原图绕过显示缓存；默认衣装、三景别、种子、续画及标定跨新旧包完整往返', async () => {
    const server = fakeMediaServer(), host = server.host(), raw = createMemoryGeneratedAssetStore();
    const store = withTavernGeneratedAssetFiles(raw, host);
    await store.putImage({ id: 'a', type: 'sprite', revision: 3, dataUrl: pixel('transparent'), originalDataUrl: pixel('original'), alphaMaskDataUrl: pixel('mask'), prompt: { positive: 'preserved' } });
    await localImageCacheFor(host).setDisplayCompression(true);
    const files = createTavernImageFiles(host, 'igs-media');
    const before = await localImageCacheFor(host).stats(), downloaded = server.downloads.length;
    const current = await raw.getImage('a');
    assert.equal(await files.read(current.dataUrl, { original: true }), pixel('transparent'));
    assert.equal(server.downloads.length, downloaded + 1);
    assert.equal((await localImageCacheFor(host).stats()).memoryBytes, before.memoryBytes);
    const library = snapshotAssetLibrary({ characters: { A: {} }, characterDna: { A: { version: 2, views: { half_body: { subject: '1.2::silver hair::' } } } },
        characterDefaultOutfits: { A: { version: 1, outfitName: '初始衣装' } }, characterSeeds: { A: 123 },
        characterOutfits: { A: { 初始衣装: { base: 'igs-gen:a', moods: { 平和: 'igs-gen:a' } } } },
        characterSpriteNotes: { A: 'manual appearance' }, generated: { expressionNotes: { 'A\u0001初始衣装': { 平和: { positive: 'preserved' } } } } });
    const output = sink(), input = { format: 'igs-character-card', characterName: 'Fixture', library,
        spriteLayouts: { 'pc::A|初始衣装::默认': { scale: 70 } } };
    const exported = await exportAssetArchive(input, { readStoredImageRecord: id => store.getImageRecord(id) }, host, 'fixture.zip', { sink: output });
    assert.equal(exported.missing, 0); assert.equal(output.closed, true);
    assert.equal((await localImageCacheFor(host).stats()).memoryBytes, before.memoryBytes);
    const streamed = await readAssetArchive(output.blob(), host);
    const legacy = parseCharacterCardPack(new Uint8Array(await output.blob().arrayBuffer()));
    assert.deepEqual(legacy.library, library); assert.equal(legacy.images[0].originalDataUrl, pixel('original'));
    let writes = 0;
    const prepared = await prepareImageImport(streamed.images, streamed, { async writeStoredImage(record, options) {
        writes++; assert.equal(options.cacheDisplay, false); assert.equal(record.originalDataUrl, pixel('original'));
        await store.putImage(record, options); return { ok: true };
    }, deleteImages: async ids => { for (const id of ids) await store.deleteImage(id); return { ok: true }; } }, { newId: () => 'new-a' });
    assert.equal(prepared.ok, true); assert.equal(writes, 1);
    assert.equal(prepared.value.library.characterOutfits.A.初始衣装.base, 'igs-gen:new-a');
    assert.deepEqual(prepared.value.library.characterDefaultOutfits, library.characterDefaultOutfits);
    assert.deepEqual(prepared.value.library.generated.expressionNotes, library.generated.expressionNotes);
    assert.equal((await localImageCacheFor(host).stats()).memoryBytes, before.memoryBytes);
    const old = await readAssetArchive(new Blob([buildCharacterCardPack({ ...input, images: [{ id: 'old', dataUrl: pixel('old') }] })]), host);
    assert.equal(old.images[0].id, 'old');
});

test('显示压缩默认关闭，开关切换拒收旧编码，重启复用同模式缓存', async () => {
    assert.equal(normalizeBridgeConfig({}).imageCache.compressDisplay, false);
    const source = Object.freeze({ imageCache: Object.freeze({ compressDisplay: true }) });
    assert.equal(normalizeBridgeConfig(source).imageCache.compressDisplay, true);
    const original = pixel('original'), display = 'data:image/webp;base64,V0VCUA==';
    let started, finish, calls = 0;
    const began = new Promise(resolve => { started = resolve; }), gate = new Promise(resolve => { finish = resolve; });
    const store = createMemoryImageCacheStore(), encoder = { accepts: () => true,
        async encode() { calls++; started(); await gate; return display; } };
    const cache = createLocalImageCache({}, { store, displayEncoder: encoder });
    await cache.put('image', original);
    assert.equal(calls, 0); assert.equal(await cache.get('image'), original);
    await cache.setDisplayCompression(true);
    assert.equal(await cache.get('image'), '');
    const old = cache.load('image', async () => original); await began;
    await cache.setDisplayCompression(false); finish();
    assert.equal(await old, ''); assert.equal(cache.peek('image'), '');
    await cache.setDisplayCompression(true); await cache.put('image', original);
    assert.equal(await cache.get('image'), display); await cache.destroy();
    const restarted = createLocalImageCache({}, { store, displayEncoder: encoder });
    await restarted.setDisplayCompression(true);
    assert.equal(await restarted.get('image'), display); assert.equal(calls, 2);
    await restarted.setDisplayCompression(false);
    assert.equal(await restarted.get('image'), '');
    await restarted.put('image', original); assert.equal(await restarted.get('image'), original); assert.equal(calls, 2);
    await restarted.destroy();
});

test('整包按需读取图片、校验损坏并回滚先前写入，直接服务端图片也跟包走', async () => {
    const server = fakeMediaServer(), host = server.host();
    const path = 'user/images/igs-media/direct.png'; server.images.set(path, pixel('direct'));
    const output = sink();
    const inline = pixel('inline');
    await exportAssetArchive({ format: 'igs-character-card', characterName: 'Fixture', library: { characters: { A: { 默认: path } },
        statusAvatars: { A: `/${path}`, B: inline } } }, null, host, 'direct.zip', { sink: output });
    const archive = await readAssetArchive(output.blob(), host);
    const id = archive.images[0].id; assert.equal(archive.library.characters.A.默认, `igs-gen:${id}`);
    assert.equal(archive.library.statusAvatars.A, `igs-gen:${id}`);
    assert.match(archive.library.statusAvatars.B, /^igs-gen:/); assert.equal(archive.images.length, 2);
    const payload = new Uint8Array(await output.blob().arrayBuffer()), view = new DataView(payload.buffer);
    payload[30 + view.getUint16(26, true)] ^= 1;
    const corrupt = await readAssetArchive(new Blob([payload]), host);
    let writes = 0;
    const result = await prepareImageImport(corrupt.images, corrupt.library, { writeStoredImage: async () => { writes++; return { ok: true }; } });
    assert.equal(result.ok, false); assert.match(result.error, /checksum/); assert.equal(writes, 0);
    const rollback = [];
    const failed = await prepareImageImport([archive.images[0], corrupt.images[0] && { ...corrupt.images[0], id: 'broken', dataUrl: pixel('second') }], archive.library,
        { async writeStoredImage(record) { if (++writes === 2) return { ok: false }; return { ok: true }; }, async deleteImages(ids) { rollback.push(...ids); return { ok: true }; } });
    assert.equal(failed.ok, false); assert.equal(rollback.length, 2);
});

test('流式 ZIP 等待写盘再读下一张，取消和损坏目录均不交付成功文件', async () => {
    let unblock, writing, read = 0;
    const ready = new Promise(resolve => { writing = resolve; }), gate = new Promise(resolve => { unblock = resolve; });
    const output = sink(), write = output.write;
    output.write = async function(bytes) { writing(); await gate; return write.call(this, bytes); };
    async function* entries() { for (let index = 0; index < 2; index++) { read++; yield { name: `image-${index}.png`, blob: new Blob(['image']) }; } }
    const controller = new AbortController(), task = writeZip(entries(), output, { signal: controller.signal });
    await ready; assert.equal(read, 1); controller.abort(); unblock();
    await assert.rejects(task, /cancelled/); assert.equal(output.aborted, true); assert.equal(output.closed, false);
    await assert.rejects(readZip(new Blob(['not a zip'])), /invalid/);
});
