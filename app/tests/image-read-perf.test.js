import test from 'node:test';
import assert from 'node:assert/strict';
import { createImageLoadQueue } from '../src/media/image-load-queue.js';
import { createLocalImageCache } from '../src/media/tavern-image-cache.js';
import { createTavernImageFiles } from '../src/media/tavern-image-files.js';
import { fakeMediaServer, pixel, settleMedia } from './helpers/fake-media-server.js';

const gate = () => { let open; const promise = new Promise(resolve => { open = resolve; }); return { promise, open }; };

test('gate:image-queue:high-priority-jumps-ahead-of-queued-low-priority', async () => {
    const queue = createImageLoadQueue(1);
    const order = [], hold = gate();
    const first = queue.run(async () => { await hold.promise; order.push('first'); });
    const low1 = queue.run(async () => { order.push('low1'); }, null, { high: false });
    const low2 = queue.run(async () => { order.push('low2'); }, null, { high: false });
    const high = queue.run(async () => { order.push('high'); });
    hold.open();
    await Promise.all([first, low1, low2, high]);
    assert.deepEqual(order, ['first', 'high', 'low1', 'low2']);
});

test('gate:image-cache:low-priority-warm-then-current-page-request-gets-boosted', async () => {
    const cache = createLocalImageCache({}, { maxCount: 20 });
    const order = [], hold = gate();
    const fill = [0, 1, 2, 3].map(i => cache.load(`user/images/igs-media/fill${i}.png`, async () => { await hold.promise; return pixel(`fill${i}`); }, { persist: false, download: true }));
    await settleMedia();
    const warm = ['a', 'b', 'c'].map(name => cache.load(`user/images/igs-media/${name}.png`, async () => { order.push(name); return pixel(name); },
        { persist: false, download: true, ticket: { high: false } }));
    await settleMedia();
    // 当前页后来才要 c：此前它在预热队尾，必须提到队首
    const wanted = cache.load('user/images/igs-media/c.png', async () => pixel('never'), { persist: false, download: true });
    hold.open();
    await Promise.all([...fill, ...warm, wanted]);
    assert.deepEqual(order, ['c', 'a', 'b']);
    await cache.destroy();
});

test('gate:image-cache:ticket-boosted-before-enqueue-also-goes-first', async () => {
    const cache = createLocalImageCache({}, { maxCount: 20 });
    const order = [], hold = gate();
    const fill = [0, 1, 2, 3].map(i => cache.load(`fill${i}.png`, async () => { await hold.promise; return pixel(`f${i}`); }, { persist: false, download: true }));
    await settleMedia();
    const lowTicket = { high: false }, highTicket = { high: false };
    const a = cache.load('a.png', async () => { order.push('a'); return pixel('a'); }, { persist: false, download: true, ticket: lowTicket });
    const b = cache.load('b.png', async () => { order.push('b'); return pixel('b'); }, { persist: false, download: true, ticket: highTicket });
    await settleMedia();
    highTicket.high = true; highTicket.boost?.();
    hold.open();
    await Promise.all([...fill, a, b]);
    assert.deepEqual(order, ['b', 'a']);
    await cache.destroy();
});

function blobHost(server) {
    let objectUrls = 0, readerCalls = 0;
    const base = server.host();
    const Reader = base.FileReader;
    const host = { ...base, Blob, URL: { createObjectURL: () => `blob:igs-test/${++objectUrls}`, revokeObjectURL() {} },
        FileReader: class extends Reader { readAsDataURL(blob) { readerCalls += 1; super.readAsDataURL(blob); } } };
    return { host, readers: () => readerCalls };
}

test('gate:image-read:display-path-returns-blob-url-without-base64-and-data-path-still-gets-dataurl', async () => {
    const server = fakeMediaServer();
    const path = 'user/images/igs-media/one.png';
    server.images.set(path, pixel('one-bytes'));
    const { host, readers } = blobHost(server);
    const files = createTavernImageFiles(host, 'igs-media');
    const shown = await files.read(path, { display: true });
    assert.match(shown, /^blob:igs-test\//);
    assert.equal(readers(), 0);
    // 同一张图再要 dataUrl：内存命中，按需转换，内容正确
    const data = await files.read(path);
    assert.equal(data, pixel('one-bytes'));
    assert.equal(readers(), 1);
    assert.equal(server.downloads.length, 1);
    // 再次显示读取内存命中，不转码
    assert.equal(await files.read(path, { display: true }), shown);
    assert.equal(readers(), 1);
});

test('gate:image-read:hydrate-default-keeps-dataurl-and-display-option-gives-blob-url', async () => {
    const server = fakeMediaServer();
    const path = 'user/images/igs-media/two.png';
    server.images.set(path, pixel('two-bytes'));
    const { host } = blobHost(server);
    const files = createTavernImageFiles(host, 'igs-media');
    assert.equal((await files.hydrate({ id: 'x', dataUrl: path }, { fields: '*' })).dataUrl, pixel('two-bytes'));
    const shown = await files.hydrate({ id: 'y', dataUrl: path }, { fields: ['dataUrl'], display: true });
    assert.match(shown.dataUrl, /^blob:igs-test\//);
});
