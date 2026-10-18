import { createCgLibrary } from './helpers/media-fixtures.js';
import { createFakeIndexedDB } from './helpers/fake-idb.js';
import test from 'node:test';
import assert from 'node:assert/strict';

import { createLocalImageCache, localImageCacheFor, normalizeImageCacheCount, DEFAULT_IMAGE_CACHE_COUNT } from '../src/media/tavern-image-cache.js';
import { withTavernIllustrationFiles } from '../src/media/tavern-illustrations.js';
import { createMemoryIllustrationStore } from '../src/media/illustration-store.js';
import { createMemoryImageCacheStore } from '../src/media/image-cache-store.js';


test('gate:image-cache:second-read-uses-local-copy-and-drop-fetches-again', async () => {
    const indexedDB = createFakeIndexedDB();
    const first = createLocalImageCache({ indexedDB }, { maxCount: 4 });
    await first.put('/user/images/igs-cg/a.png', 'data:image/png;base64,AAA');
    await first.destroy();
    const old = indexedDB.databases.get('igs-image-cache'); old.version = 3;
    for (const row of old.stores.get('meta').rows.values()) delete row.displayCompressed;
    const second = createLocalImageCache({ indexedDB }, { maxCount: 4 });
    assert.equal(await second.get('user/images/igs-cg/a.png'), 'data:image/png;base64,AAA');
    assert.equal(old.version, 4);
    await second.drop('user/images/igs-cg/a.png');
    const third = createLocalImageCache({ indexedDB }, { maxCount: 4 });
    assert.equal(await third.get('user/images/igs-cg/a.png'), '');
});

test('gate:image-cache:drops-the-oldest-when-over-the-count', async () => {
    let clock = 0;
    const cache = createLocalImageCache({}, { maxCount: 3, now: () => { clock += 1; return clock; } });
    await cache.put('a.png', 'data:image/png;base64,A');
    await cache.put('b.png', 'data:image/png;base64,B');
    await cache.put('older.png', 'data:image/png;base64,OLD');
    await cache.get('a.png');
    await cache.put('c.png', 'data:image/png;base64,C');
    assert.equal(await cache.get('b.png'), '');
    assert.equal(await cache.get('older.png'), '');
    assert.equal(await cache.get('a.png'), 'data:image/png;base64,A');
    assert.equal(await cache.get('c.png'), 'data:image/png;base64,C');
});

test('gate:image-cache:illustration-hydrate-downloads-a-path-once', async () => {
    let downloads = 0;
    const globalObject = {
        setTimeout,
        indexedDB: createFakeIndexedDB(),
        fetch(_url, options = {}) {
            if (options.method === 'POST') return Promise.resolve(null);
            downloads += 1;
            return Promise.resolve({
                ok: true,
                blob: async () => new Blob(['cg-bytes']),
            });
        },
        FileReader: class {
            readAsDataURL(blob) {
                blob.text().then((text) => {
                    this.result = `data:image/png;base64,${Buffer.from(text).toString('base64')}`;
                    if (typeof this.onload === 'function') this.onload();
                }).catch(() => { if (typeof this.onerror === 'function') this.onerror(); });
            }
        },
    };
    const path = 'user/images/igs-cg/floor@cg@dataUrl@abc.png';
    const store = createMemoryIllustrationStore();
    await store.putSlot('chat|1|0', { slot: 1, status: 'done', dataUrl: path });
    const files = withTavernIllustrationFiles(store, globalObject);
    const first = await files.getSlots('chat|1|0');
    const second = await files.getSlots('chat|1|0');
    assert.equal(downloads, 1);
    assert.equal(first[0].dataUrl, second[0].dataUrl);
    assert.match(first[0].dataUrl, /^data:image\/png;base64,/);

    await files.deleteSlot('chat|1|0', 1);
    await store.putSlot('chat|1|0', { slot: 1, status: 'done', dataUrl: path });
    await files.getSlots('chat|1|0');
    assert.equal(downloads, 2);
});

test('gate:image-cache:cg-library-shows-a-ready-image-before-the-slow-one', async () => {
    let releaseSlow;
    const slowGate = new Promise((resolve) => { releaseSlow = resolve; });
    const globalObject = {
        setTimeout,
        fetch(url) {
            const pending = String(url).includes('slow') ? slowGate : Promise.resolve();
            return pending.then(() => ({ ok: true, blob: async () => new Blob([String(url)]) }));
        },
        FileReader: class {
            readAsDataURL(blob) {
                blob.text().then((text) => {
                    this.result = `data:image/png;base64,${Buffer.from(text).toString('base64')}`;
                    if (typeof this.onload === 'function') this.onload();
                }).catch(() => { if (typeof this.onerror === 'function') this.onerror(); });
            }
        },
    };
    const store = createMemoryIllustrationStore();
    await store.putSlot('chat|1|0', { slot: 1, status: 'done', dataUrl: 'user/images/igs-cg/fast.png' });
    await store.putSlot('chat|2|0', { slot: 1, status: 'done', dataUrl: 'user/images/igs-cg/slow.png' });
    const library = createCgLibrary({ mediaCache: localImageCacheFor(globalObject), illustrationStore: withTavernIllustrationFiles(store, globalObject), clearIllustration: async () => ({ ok: true }) });
    const synced = await library.syncIndex();
    const entries = synced.entries.sort((a, b) => a.messageId - b.messageId);
    assert.deepEqual(entries.map((e) => e.key), ['chat|1|0|1', 'chat|2|0|1']);
    const jobs = entries.map((entry) => library.readFull(entry));
    const fast = await jobs[0];
    assert.match(fast.dataUrl, /^data:image\/png;base64,/);
    let slowDone = false;
    jobs[1].then(() => { slowDone = true; });
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(slowDone, false);
    releaseSlow();
    const slow = await jobs[1];
    assert.match(slow.dataUrl, /^data:image\/png;base64,/);
});

test('gate:image-cache:a-stalled-download-is-aborted-instead-of-waiting-forever', async () => {
    const realSetTimeout = setTimeout;
    let aborted = false;
    const globalObject = {
        setTimeout: (fn, ms) => realSetTimeout(fn, ms >= 30000 ? 5 : ms),
        clearTimeout,
        AbortController,
        fetch(_url, options = {}) {
            return new Promise((_, reject) => {
                options.signal.addEventListener('abort', () => { aborted = true; reject(new Error('aborted')); });
            });
        },
        FileReader: class {},
    };
    const store = createMemoryIllustrationStore();
    await store.putSlot('chat|1|0', { slot: 1, status: 'done', dataUrl: 'user/images/igs-cg/stuck.png' });
    const files = withTavernIllustrationFiles(store, globalObject);
    const out = await files.hydrateSlot({ dataUrl: 'user/images/igs-cg/stuck.png' });
    assert.equal(aborted, true);
    assert.equal(out.dataUrl, '');
});

test('gate:image-cache:count-defaults-to-320-and-a-lower-limit-drops-the-oldest', async () => {
    assert.equal(normalizeImageCacheCount(undefined), DEFAULT_IMAGE_CACHE_COUNT);
    assert.equal(DEFAULT_IMAGE_CACHE_COUNT, 320);
    assert.equal(normalizeImageCacheCount(5000), 2000);
    assert.equal(normalizeImageCacheCount(0), 1);
    let clock = 0;
    const cache = createLocalImageCache({}, { maxCount: 3, now: () => { clock += 1; return clock; } });
    await cache.put('a.png', 'data:image/png;base64,A');
    await cache.put('b.png', 'data:image/png;base64,B');
    await cache.put('c.png', 'data:image/png;base64,C');
    assert.equal(await cache.setMaxCount(2), 2);
    assert.equal(await cache.get('a.png'), '');
    assert.equal(await cache.get('b.png'), '');
    assert.equal(await cache.get('c.png'), 'data:image/png;base64,C');
});

test('gate:image-cache:clear-drops-every-cached-image', async () => {
    const cache = createLocalImageCache({});
    await cache.put('user/images/igs-cg/a.png', 'data:image/png;base64,AAA');
    await cache.clear();
    assert.equal(await cache.get('user/images/igs-cg/a.png'), '');
});

test('图片缓存超限后按 LRU 批量清到低水位，后续写入使用已腾出的余量', async () => {
    const batches = [], store = createMemoryImageCacheStore(), remove = store.deleteMany;
    store.deleteMany = async paths => { batches.push([...paths]); await remove(paths); };
    let time = 0;
    const cache = createLocalImageCache({}, { store, maxCount: 10, now: () => ++time });
    for (let index = 0; index < 10; index++) await cache.put(`image:${index}`, `data:image/png;base64,${index}`);
    await cache.get('image:0');
    await cache.put('image:10', 'data:image/png;base64,10');
    const trimmed = await cache.stats();
    assert.equal(trimmed.memoryCount, 8); assert.equal(trimmed.diskCount, 8);
    assert.deepEqual(batches, [['image:1', 'image:2', 'image:3']]);
    assert.ok(cache.peek('image:0')); assert.equal(cache.peek('image:1'), '');
    await cache.put('image:11', 'data:image/png;base64,11');
    await cache.put('image:12', 'data:image/png;base64,12');
    assert.equal(batches.length, 1); assert.equal((await cache.stats()).diskCount, 10);
    await cache.destroy();
    const byteBatches = [], byteStore = createMemoryImageCacheStore(), deleteBytes = byteStore.deleteMany;
    byteStore.deleteMany = async paths => { byteBatches.push([...paths]); await deleteBytes(paths); };
    const bytes = createLocalImageCache({ Blob }, { store: byteStore, maxCount: 100, memoryBytes: 1000, maxBytes: 1000 });
    for (let index = 0; index < 5; index++) await bytes.put(`bytes:${index}`, new Blob([new Uint8Array(250)]));
    const usage = await bytes.stats();
    assert.equal(usage.memoryBytes, 750); assert.equal(usage.diskBytes, 750);
    assert.deepEqual(byteBatches, [['bytes:0', 'bytes:1']]);
    await bytes.destroy();
});

test('别名与版本索引也批量清理，现有租约和在途读取保持有效', async () => {
    const cache = createLocalImageCache({}, { maxCount: 2 });
    const release = cache.pin('alias:0');
    for (let index = 0; index < 10; index++) cache.remember(`alias:${index}`, 'data:image/png;base64,SAME');
    assert.ok(cache.peek('alias:0')); assert.equal(cache.peek('alias:2'), ''); assert.ok(cache.peek('alias:9'));
    assert.equal(cache.size(), 1); release(); await cache.destroy();
    const tokens = createLocalImageCache({}, { maxCount: 2 });
    let finish;
    const gate = new Promise(resolve => { finish = resolve; });
    const pending = tokens.load('loading', () => gate, { persist: false });
    const activeToken = tokens.token('loading'), previous = [];
    for (let index = 0; index < 16; index++) previous.push(tokens.token(`unused:${index}`));
    assert.notEqual(tokens.token('unused:2'), previous[2]);
    assert.equal(tokens.token('loading'), activeToken);
    finish('data:image/png;base64,DONE'); assert.equal(await pending, 'data:image/png;base64,DONE');
    await tokens.destroy();
});
