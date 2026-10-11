import test from 'node:test';
import assert from 'node:assert/strict';

import { withTavernIllustrationFiles, CG_RECORDS_FILE } from '../src/media/tavern-image-files.js';
import { createMemoryIllustrationStore } from '../src/media/illustration-store.js';

// 假酒馆：user/files 下的 JSON 与 user/images/igs-cg 的文件名列表，记录上传。
function fakeTavern({ backup = null, names = [] } = {}) {
    const state = { backup, uploads: [] };
    const globalObject = {
        setTimeout: (fn, ms) => setTimeout(fn, Math.min(ms, 5)),
        clearTimeout,
        btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
        SillyTavern: { getContext: () => ({ getRequestHeaders: () => ({ 'Content-Type': 'application/json' }) }) },
        async fetch(url, options = {}) {
            if (String(url).startsWith(`/user/files/${CG_RECORDS_FILE}`)) {
                return state.backup ? { ok: true, status: 200, json: async () => state.backup } : { ok: false, status: 404 };
            }
            if (url === '/api/files/upload') {
                const body = JSON.parse(options.body);
                state.backup = JSON.parse(Buffer.from(body.data, 'base64').toString('utf8'));
                state.uploads.push(body.name);
                return { ok: true };
            }
            if (url === '/api/images/list') return { ok: true, json: async () => names };
            return { ok: false, status: 404 };
        },
    };
    return { globalObject, state };
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('gate:cg-backup:records-are-mirrored-and-restored-after-cache-clear', async () => {
    const { globalObject, state } = fakeTavern();
    const first = withTavernIllustrationFiles(createMemoryIllustrationStore(), globalObject);
    await first.putSlot('角色 - 2026|3|0', { slot: 1, status: 'done', caption: 'rain', dataUrl: 'user/images/igs-cg/a.png' });
    await wait(30);
    assert.deepEqual(state.uploads, [CG_RECORDS_FILE]);
    assert.equal(state.backup.slots['角色 - 2026|3|0|1'].caption, 'rain');

    // 清缓存：换一个空的本地库，备份文件还在。
    const fresh = createMemoryIllustrationStore();
    const second = withTavernIllustrationFiles(fresh, globalObject);
    assert.deepEqual(await second.listSlotKeys(), ['角色 - 2026|3|0|1']);
    const raw = await fresh.getSlotRecord('角色 - 2026|3|0|1');
    assert.equal(raw.dataUrl, 'user/images/igs-cg/a.png', '记录补回本地，图仍指向酒馆文件');

    await second.deleteSlot('角色 - 2026|3|0', 1);
    await wait(30);
    assert.deepEqual(Object.keys(state.backup.slots), [], '删除同步进备份');
});

test('gate:cg-backup:existing-local-records-seed-the-backup-and-network-errors-never-overwrite-it', async () => {
    const store = createMemoryIllustrationStore();
    await store.putSlot('chat|1|0', { slot: 1, status: 'done', dataUrl: 'user/images/igs-cg/x.png' });
    await store.putSlot('chat|2|0', { slot: 1, status: 'done', dataUrl: 'data:image/png;base64,AAAA' });
    const { globalObject, state } = fakeTavern();
    await withTavernIllustrationFiles(store, globalObject).listSlotKeys();
    await wait(30);
    assert.deepEqual(Object.keys(state.backup.slots), ['chat|1|0|1'], '只备份已搬进酒馆文件夹的');

    const broken = fakeTavern({ backup: { version: 1, slots: { 'old|1|0|1': { slot: 1, dataUrl: 'user/images/igs-cg/o.png' } } } });
    const realFetch = broken.globalObject.fetch;
    broken.globalObject.fetch = async (url, options) => (String(url).startsWith('/user/files/') ? Promise.reject(new Error('net')) : realFetch(url, options));
    const wrapped = withTavernIllustrationFiles(createMemoryIllustrationStore(), broken.globalObject);
    await wrapped.putSlot('chat|9|0', { slot: 1, status: 'done', dataUrl: 'user/images/igs-cg/n.png' });
    await wait(30);
    assert.deepEqual(broken.state.uploads, [], '读不到备份时不上传，免得盖掉');
});

test('gate:cg-backup:floor-images-from-before-the-backup-are-recognised-by-file-name', async () => {
    const { globalObject } = fakeTavern({ names: ['chat_5_0_1@@dataUrl@0123456789abcdef.png', 'chat_5_0_2@@dataUrl@fedcba9876543210.webp', 'chat_50_0_1@@dataUrl@aaaaaaaaaaaaaaaa.png'] });
    const wrapped = withTavernIllustrationFiles(createMemoryIllustrationStore(), globalObject);
    globalObject.fetch = ((inner) => async (url, options) => (String(url).startsWith('/user/images/') ? { ok: true, blob: async () => new Blob(['x']) } : inner(url, options)))(globalObject.fetch);
    globalObject.FileReader = class { readAsDataURL() { this.result = 'data:image/png;base64,eA=='; this.onload(); } };
    const slots = await wrapped.getSlots('chat|5|0');
    assert.deepEqual(slots.map((s) => [s.slot, s.status]), [[1, 'done'], [2, 'done']], '只认这一楼的，第 50 楼的不算');
});


function candidateFilesFixture() {
    const f = fakeTavern();
    const files = new Map([['user/images/igs-cg/original.png', 'OLD']]);
    const deleted = [], uploaded = [];
    const originalFetch = f.globalObject.fetch;
    f.globalObject.FileReader = class { readAsDataURL(blob) { blob.text().then((data) => { this.result = `data:image/png;base64,${data}`; this.onload(); }); } };
    f.globalObject.fetch = async (url, options = {}) => {
        const body = options.body && JSON.parse(options.body);
        if (url === '/api/images/upload') {
            const path = `user/images/igs-cg/${body.filename}.png`;
            uploaded.push(path); files.set(path, body.image);
            return { ok: true, json: async () => ({ path }) };
        }
        if (url === '/api/images/delete') { deleted.push(body.path); files.delete(body.path); return { ok: true }; }
        if (String(url).startsWith('/user/images/')) return { ok: files.has(url.slice(1)), blob: async () => new Blob([files.get(url.slice(1))]) };
        return originalFetch(url, options);
    };
    return { ...f, files, deleted, uploaded };
}

test('gate:cg-accept:files-baseline-backup-and-restored-metadata', async () => {
    const f = candidateFilesFixture(), raw = createMemoryIllustrationStore();
    const before = await raw.putSlot('chat|5|0', { slot: 7, status: 'done', dataUrl: 'user/images/igs-cg/original.png',
        characterMeta: { version: 1, characters: [{ characterKey: 'A' }] }, caption: { scene: 'fixture' }, originalSize: { width: 128, height: 64 } });
    const wrapped = withTavernIllustrationFiles(raw, f.globalObject);
    const accepted = await wrapped.updateSlot('chat|5|0', 7, before.revision,
        { dataUrl: 'data:image/png;base64,NEW', updatedAt: 't1' }, { expectedToken: before.revisionToken, preserveBaseline: true });
    assert.equal(accepted.ok, true);
    assert.equal(accepted.record.dataUrl, 'data:image/png;base64,NEW');
    const saved = await raw.getSlotRecord(before.key);
    assert.equal(saved.consistencyBaselineDataUrl, before.dataUrl);
    assert.deepEqual(saved.consistencyBaselineMeta.characterMeta, before.characterMeta);
    assert.equal(f.deleted.includes(before.dataUrl), false);
    await wait(30);
    const restored = createMemoryIllustrationStore();
    await withTavernIllustrationFiles(restored, f.globalObject).listSlotKeys();
    const copy = await restored.getSlotRecord(before.key);
    assert.deepEqual(copy.characterMeta, before.characterMeta);
    assert.deepEqual(copy.consistencyBaselineMeta, saved.consistencyBaselineMeta);
    assert.equal(copy.consistencyBaselineDataUrl, before.dataUrl);
    await wrapped.deleteSlot('chat|5|0', 7);
    assert.ok(f.deleted.includes(before.dataUrl));
    assert.ok(f.deleted.includes(saved.dataUrl));
});

test('gate:cg-accept:conflict-storage-failure-and-concurrent-accept-only-drop-new-files', async () => {
    for (const mode of ['conflict', 'storage', 'concurrent']) {
        const f = candidateFilesFixture(), raw = createMemoryIllustrationStore();
        const before = await raw.putSlot('chat|5|0', { slot: 7, status: 'done', dataUrl: 'user/images/igs-cg/original.png' });
        const underlying = mode === 'storage' ? { ...raw, updateSlot: async () => { throw new Error('fixture'); } } : raw;
        const wrapped = withTavernIllustrationFiles(underlying, f.globalObject);
        let live = true;
        if (mode === 'conflict') {
            const fetch = f.globalObject.fetch;
            f.globalObject.fetch = async (url, options) => { const result = await fetch(url, options);if (url === '/api/images/upload') live = false; return result; };
        }
        const write = () => wrapped.updateSlot('chat|5|0', 7, before.revision, { dataUrl: 'data:image/png;base64,NEW' },
            { expectedToken: before.revisionToken, preserveBaseline: true, shouldCommit: () => live });
        if (mode === 'storage') await assert.rejects(write(), /fixture/);
        else if (mode === 'conflict') assert.equal((await write()).reason, 'stale-target');
        else {
            const results = await Promise.all([write(), write()]);
            assert.equal(results.filter((r) => r.ok).length, 1);
            assert.equal(results.find((r) => !r.ok).reason, 'stale-revision');
        }
        assert.equal(f.deleted.includes(before.dataUrl), false, mode);
        assert.equal(f.uploaded.length, 1);
        if (mode !== 'concurrent') {
            assert.deepEqual(await raw.getSlotRecord(before.key), before);
            assert.deepEqual(f.deleted, f.uploaded);
        }
    }
});

test('gate:cg-backup:三阶段资料经 IDB 写口、文件备份和清缓存恢复', async () => {
    const { createIndexedDbIllustrationStore } = await import('../src/media/illustration-store.js');
    const { createTransactionalIdb } = await import('./helpers/transactional-idb.js');
    const { provenanceFixture } = await import('./helpers/prompt-provenance.js');
    const { promptProvenance } = await import('../src/generated-images/generation-prompt.js');
    const fixture = provenanceFixture(), f = candidateFilesFixture();
    const first = withTavernIllustrationFiles(createIndexedDbIllustrationStore({ indexedDB: createTransactionalIdb() }), f.globalObject);
    const before = await first.putSlot('fixture|3|0', { slot: 1, status: 'done', dataUrl: 'data:image/png;base64,T0xE',
        caption: fixture.caption, prompt: fixture.prompt, characterMeta: fixture.characterMeta, ...promptProvenance(fixture) });
    const saved = await first.updateSlot('fixture|3|0', 1, before.revision,
        { dataUrl: 'data:image/png;base64,TkVX' }, { expectedToken: before.revisionToken, preserveBaseline: true });
    assert.equal(saved.ok, true);
    await wait(40);
    const fresh = createIndexedDbIllustrationStore({ indexedDB: createTransactionalIdb() });
    const restored = withTavernIllustrationFiles(fresh, f.globalObject);
    await restored.listSlotKeys();
    const raw = await fresh.getSlotRecord('fixture|3|0|1');
    for (const field of ['promptRecipe', 'dnaSnapshot', 'sentPrompt']) {
        assert.deepEqual(raw[field], fixture[field], field);
        assert.deepEqual(raw.consistencyBaselineMeta[field], fixture[field], `baseline:${field}`);
    }
    assert.match(raw.dataUrl, /^user\/images\/igs-cg\//);
    assert.equal(JSON.stringify(raw.sentPrompt).includes('base64'), false);
    assert.equal((await restored.getSlots('fixture|3|0'))[0].dataUrl, 'data:image/png;base64,TkVX');
});

test('gate:cg-consistency:文件 offload 清除整图 wire 并保真恢复轮次与基线', async () => {
    const { createIndexedDbIllustrationStore } = await import('../src/media/illustration-store.js');
    const { createTransactionalIdb } = await import('./helpers/transactional-idb.js');
    const { provenanceFixture, consistencyProvenanceFixture } = await import('./helpers/prompt-provenance.js');
    const { promptProvenance, storedPromptFromResult } = await import('../src/generated-images/generation-prompt.js');
    const fixture = provenanceFixture(), consistencyPrompt = consistencyProvenanceFixture();
    const f = candidateFilesFixture(), indexedDB = createTransactionalIdb();
    const rawStore = createIndexedDbIllustrationStore({ indexedDB });
    const first = withTavernIllustrationFiles(rawStore, f.globalObject);
    const before = await first.putSlot('fixture|3|0', { slot: 1, status: 'done', dataUrl: 'data:image/png;base64,T0xE',
        caption: fixture.caption, prompt: fixture.prompt, characterMeta: fixture.characterMeta,
        ...promptProvenance(fixture), consistencyPrompt });
    const { sentPrompt, ...scene } = fixture;
    const accepted = await first.updateSlot('fixture|3|0', 1, before.revision,
        { dataUrl: 'data:image/png;base64,TkVX', ...promptProvenance(scene),
            prompt: storedPromptFromResult({ ...scene, prompt: undefined }), consistencyPrompt },
        { expectedToken: before.revisionToken, preserveBaseline: true, clearSentPrompt: true });
    assert.equal(accepted.ok, true);
    const stored = await createIndexedDbIllustrationStore({ indexedDB }).getSlotRecord(before.key);
    assert.equal(stored.sentPrompt, undefined);
    assert.equal(stored.prompt.sentPrompt, undefined);
    assert.deepEqual(stored.consistencyPrompt, consistencyPrompt);
    assert.deepEqual(stored.consistencyBaselineMeta.consistencyPrompt, consistencyPrompt);
    assert.deepEqual(stored.consistencyBaselineMeta.sentPrompt, sentPrompt);
    assert.match(stored.dataUrl, /^user\/images\/igs-cg\//);
    assert.equal(f.deleted.includes(stored.consistencyBaselineDataUrl), false);
    await wait(40);
    const fresh = createIndexedDbIllustrationStore({ indexedDB: createTransactionalIdb() });
    const restored = withTavernIllustrationFiles(fresh, f.globalObject);
    await restored.listSlotKeys();
    const copy = await fresh.getSlotRecord(before.key);
    for (const field of ['prompt', 'promptRecipe', 'dnaSnapshot', 'consistencyPrompt', 'consistencyBaselineMeta'])
        assert.deepEqual(copy[field], stored[field], field);
    assert.equal(copy.sentPrompt, undefined);
    assert.equal((await restored.getSlots('fixture|3|0'))[0].dataUrl, 'data:image/png;base64,TkVX');
});


for (const phase of ['upload', 'preflight', 'transaction', 'accepted']) test(`gate:cg-consistency:文件上传与提交租约 ${phase}`, async () => {
    const { createIndexedDbIllustrationStore } = await import('../src/media/illustration-store.js');
    const { createTransactionalIdb } = await import('./helpers/transactional-idb.js');
    const { provenanceFixture } = await import('./helpers/prompt-provenance.js');
    const { promptProvenance } = await import('../src/generated-images/generation-prompt.js');
    const fixture = provenanceFixture(), f = candidateFilesFixture();
    const indexedDB = createTransactionalIdb(), raw = createIndexedDbIllustrationStore({ indexedDB });
    const before = await raw.putSlot('fixture|3|0', { slot: 1, status: 'done', dataUrl: 'user/images/igs-cg/original.png',
        caption: fixture.caption, prompt: fixture.prompt, ...promptProvenance(fixture) });
    let current = true, checks = 0, commits = 0;
    const fetch = f.globalObject.fetch;
    f.globalObject.fetch = async (url, options) => {
        const result = await fetch(url, options);
        if (url === '/api/images/upload' && phase === 'upload') current = false;
        return result;
    };
    const update = raw.updateSlot;
    raw.updateSlot = async (...args) => {
        commits++;
        assert.equal(args[4].beforeCommit, undefined, '文件层消费异步复核，事务内不重复等待');
        const result = update(...args);
        if (phase === 'transaction') current = false;
        return result;
    };
    const wrapped = withTavernIllustrationFiles(raw, f.globalObject);
    const save = () => wrapped.updateSlot('fixture|3|0', 1, before.revision,
        { dataUrl: 'data:image/png;base64,TkVX' }, { expectedToken: before.revisionToken, preserveBaseline: true,
            async beforeCommit() {
                checks++;
                assert.equal(f.uploaded.length, 1, '复核必须在上传后');
                if (phase === 'preflight') throw new Error('fixture-config-read-failed');
                if (!current) throw new Error('stale-config');
            }, shouldCommit: () => current });
    if (['upload', 'preflight'].includes(phase)) await assert.rejects(save(), /stale-config|fixture-config-read-failed/);
    else assert.equal((await save()).ok, phase === 'accepted');
    assert.equal(checks, 1);
    assert.equal(commits, ['upload', 'preflight'].includes(phase) ? 0 : 1);
    assert.equal(f.deleted.includes(before.dataUrl), false);
    const saved = await createIndexedDbIllustrationStore({ indexedDB }).getSlotRecord(before.key);
    if (phase === 'accepted') {
        assert.notEqual(saved.revisionToken, before.revisionToken);
        assert.equal(saved.consistencyBaselineDataUrl, before.dataUrl);
    } else {
        assert.deepEqual(saved, before, '拒绝后正文、来源与原图逐字段保真');
        assert.deepEqual(f.deleted, f.uploaded, '只清理本次新上传文件');
    }
});
