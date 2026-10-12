import { createIdbConnection } from './idb-connection.js';
// 生成素材存储：images 存图片本体（素材库与临时素材共用，按 id 引用），
// assets 存本聊天的临时素材记录（按 chatId / floorKey 查询），floors 记录楼层是否已处理过。
const DB_NAME = 'igs-generated-assets';
const DB_VERSION = 1;

const clone = (v) => (v == null ? null : JSON.parse(JSON.stringify(v)));

export const GENERATED_IMAGE_SCHEMA_VERSION = 2;

// 旧记录只有 dataUrl：视为 legacy，不能恢复已丢失像素；不伪造 originalDataUrl。
export function isLegacyGeneratedImage(record) {
    return !record || typeof record.originalDataUrl !== 'string' || !record.originalDataUrl;
}

// 图片记录规范化：dataUrl 始终是当前透明结果（旧消费者继续读取），原图不可变，revision 用于过期检查。
export function normalizeGeneratedImageRecord(raw) {
    if (!raw || typeof raw !== 'object' || !raw.id) return null;
    const str = (v) => (typeof v === 'string' ? v : '');
    const legacy = isLegacyGeneratedImage(raw);
    return {
        ...raw,
        schemaVersion: legacy ? 1 : GENERATED_IMAGE_SCHEMA_VERSION,
        dataUrl: str(raw.dataUrl),
        originalDataUrl: str(raw.originalDataUrl),
        workingDataUrl: str(raw.workingDataUrl),
        alphaMaskDataUrl: str(raw.alphaMaskDataUrl),
        revision: Number.isInteger(raw.revision) && raw.revision > 0 ? raw.revision : 1,
    };
}

export function isQuotaError(error) {
    return Boolean(error) && (error.name === 'QuotaExceededError' || error.code === 22 || /quota/i.test(String(error.message || error.name || '')));
}

// 修复结果的原子更新规则：legacy 记录不可编辑；revision 不匹配视为过期；originalDataUrl / id 永不改写。
export function applyGeneratedImageUpdate(current, expectedRevision, patch = {}, updatedAt = '') {
    const record = normalizeGeneratedImageRecord(current);
    if (!record) return { ok: false, reason: 'not-found' };
    if (isLegacyGeneratedImage(record)) return { ok: false, reason: 'source-unavailable' };
    if (record.revision !== expectedRevision) return { ok: false, reason: 'stale-revision', revision: record.revision };
    const next = {
        ...record,
        schemaVersion: GENERATED_IMAGE_SCHEMA_VERSION,
        revision: record.revision + 1,
        updatedAt: updatedAt || new Date().toISOString(),
    };
    const source = patch && typeof patch === 'object' ? patch : {};
    for (const field of ['dataUrl', 'workingDataUrl', 'alphaMaskDataUrl']) {
        if (typeof source[field] === 'string') next[field] = source[field];
    }
    if (Object.prototype.hasOwnProperty.call(source, 'matteCrop')) {
        next.matteCrop = source.matteCrop && typeof source.matteCrop === 'object' ? { ...source.matteCrop } : null;
    }
    if (!next.dataUrl) return { ok: false, reason: 'empty-result' };
    return { ok: true, record: next };
}

export function createMemoryGeneratedAssetStore() {
    const images = new Map();
    const assets = new Map();
    const floors = new Map();
    return {
        async getImage(id) { return clone(images.get(id)); },
        async putImage(value) { images.set(value.id, clone(value)); },
        async deleteImage(id) { images.delete(id); },
        async listImages() { return Array.from(images.values(), clone); },
        async listAssets() { return Array.from(assets.values(), clone); },
        async listFloors() { return Array.from(floors.values(), clone); },
        async deleteAsset(key) { assets.delete(key); },
        async deleteFloor(key) { floors.delete(key); },
        async patchImageMetadata(id, patch) {
            const old = images.get(id);
            if (!old) return { ok: false, reason: 'not-found' };
            const next = { ...old, ...patch, id }; images.set(id, clone(next));
            return { ok: true, record: clone(next) };
        },
        async putImages(list) { for (const value of list) images.set(value.id, clone(value)); },
        async updateImage(id, expectedRevision, patch, updatedAt) {
            const result = applyGeneratedImageUpdate(images.get(id), expectedRevision, patch, updatedAt);
            if (result.ok) images.set(id, clone(result.record));
            return result.ok ? { ok: true, record: clone(result.record) } : result;
        },
        async getAssetsByChat(chatId) { return Array.from(assets.values()).filter((a) => a.chatId === chatId).map(clone); },
        async getAssetsByFloor(floorKey) { return Array.from(assets.values()).filter((a) => a.floorKey === floorKey).map(clone); },
        async putAsset(value) { assets.set(value.key, clone(value)); },
        async getFloor(key) { return clone(floors.get(key)); },
        async putFloor(key, value) { floors.set(key, clone({ ...value, key })); },
    };
}

export function createIndexedDbGeneratedAssetStore(globalObject = globalThis) {
    const idb = globalObject && globalObject.indexedDB;
    if (!idb) return createMemoryGeneratedAssetStore();
    const connection = createIdbConnection(idb, DB_NAME, DB_VERSION, db => {
        if (!db.objectStoreNames.contains('images')) db.createObjectStore('images', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('floors')) db.createObjectStore('floors', { keyPath: 'key' });
        if (!db.objectStoreNames.contains('assets')) {
            const store = db.createObjectStore('assets', { keyPath: 'key' });
            store.createIndex('chatId', 'chatId', { unique: false });
            store.createIndex('floorKey', 'floorKey', { unique: false });
        }
    });
    const run = (name, mode, fn) => connection.transact(name, mode, tx => fn(tx.objectStore(name)));
    return {
        async getImage(id) { return (await run('images', 'readonly', (s) => s.get(id))) || null; },
        async putImage(value) { await run('images', 'readwrite', (s) => s.put(value)); },
        async deleteImage(id) { await run('images', 'readwrite', (s) => s.delete(id)); },
        // 读取与写入在同一 readwrite 事务内，避免另一会话在检查与写入之间覆盖。
        async updateImage(id, expectedRevision, patch, updatedAt) {
            return connection.transact('images', 'readwrite', tx => {
                const objectStore = tx.objectStore('images');
                let outcome = { ok: false, reason: 'not-found' };
                const req = objectStore.get(id);
                req.onsuccess = () => {
                    outcome = applyGeneratedImageUpdate(req.result, expectedRevision, patch, updatedAt);
                    if (outcome.ok) objectStore.put(outcome.record);
                };
                return () => outcome;
            });
        },
        async patchImageMetadata(id, patch) {
            return connection.transact('images', 'readwrite', tx => {
                const objectStore = tx.objectStore('images');
                let outcome = { ok: false, reason: 'not-found' };
                const req = objectStore.get(id);
                req.onsuccess = () => {
                    if (!req.result) return;
                    const record = { ...req.result, ...patch, id };
                    objectStore.put(record); outcome = { ok: true, record };
                };
                return () => outcome;
            });
        },
        async listImages() { return await run('images', 'readonly', s => s.getAll()) || []; },
        async listAssets() { return await run('assets', 'readonly', s => s.getAll()) || []; },
        async listFloors() { return await run('floors', 'readonly', s => s.getAll()) || []; },
        async deleteAsset(key) { await run('assets', 'readwrite', s => s.delete(key)); },
        async deleteFloor(key) { await run('floors', 'readwrite', s => s.delete(key)); },
        async putImages(list) {
            await run('images', 'readwrite', s => { for (const value of list) s.put(value); return () => undefined; });
        },
        async getAssetsByChat(chatId) { return (await run('assets', 'readonly', (s) => s.index('chatId').getAll(chatId))) || []; },
        async getAssetsByFloor(floorKey) { return (await run('assets', 'readonly', (s) => s.index('floorKey').getAll(floorKey))) || []; },
        async putAsset(value) { await run('assets', 'readwrite', (s) => s.put(value)); },
        async getFloor(key) { return (await run('floors', 'readonly', (s) => s.get(key))) || null; },
        async putFloor(key, value) { await run('floors', 'readwrite', (s) => s.put({ ...value, key })); },
    };
}
