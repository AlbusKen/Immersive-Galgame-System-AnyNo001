import { createIdbImageCacheStore, createMemoryImageCacheStore } from './image-cache-store.js';
import { blobDataUrl, dataUrlBlob, dataUrlBytes, imageFingerprint, normalizeImagePath } from './image-identity.js';
import { withMediaLock } from './media-lock.js';
import { createImageLoadQueue } from './image-load-queue.js';

export const DEFAULT_IMAGE_CACHE_COUNT = 320;
export const IMAGE_MEMORY_BUDGET = 64 * 1024 * 1024;
export const IMAGE_DISK_BUDGET = 192 * 1024 * 1024;
export function normalizeImageCacheCount(value) {
    const count = Math.round(Number(value));
    return Number.isFinite(count) ? Math.min(2000, Math.max(1, count)) : DEFAULT_IMAGE_CACHE_COUNT;
}
const caches = new WeakMap();
const diskUsage = rows => {
    const unique = new Map();
    for (const row of rows.values()) unique.set(row.identity || row.path, Math.max(0, Number(row.bytes) || 0));
    return { count: unique.size, bytes: [...unique.values()].reduce((sum, bytes) => sum + bytes, 0) };
};

export function createLocalImageCache(globalObject = globalThis, options = {}) {
    const now = options.now || (() => Date.now());
    const store = options.store || (globalObject.indexedDB ? createIdbImageCacheStore(globalObject.indexedDB) : createMemoryImageCacheStore());
    const memory = new Map();
    const aliases = new Map();
    const flights = new Map();
    const versions = new Map();
    const listeners = new Set();
    const urlOwners = new Map();
    const pins = new Map();
    const downloads = createImageLoadQueue(4);
    const Abort = globalObject.AbortController || globalThis.AbortController;
    let readController = Abort ? new Abort() : null;
    let maxCount = normalizeImageCacheCount(options.maxCount);
    const maxBytes = options.maxBytes || IMAGE_DISK_BUDGET;
    const memoryBytes = options.memoryBytes || IMAGE_MEMORY_BUDGET;
    let meta = null;
    let epoch = 0;
    let serial = Promise.resolve();
    let lastError = '';
    let destroyed = false, nextVersion = 0;
    const channel = typeof globalObject.BroadcastChannel === 'function' ? new globalObject.BroadcastChannel('igs-media-cache-v3') : null;
    if (channel) channel.onmessage = event => {
        if (event.data?.type === 'clear') void clear({ memoryOnly: true, broadcast: false });
        if (event.data?.type === 'drop' && typeof event.data.key === 'string') forget(event.data.key);
        meta = null;
    };
    const enqueue = task => {
        const result = serial.then(() => withMediaLock(globalObject, 'cache', task));
        serial = result.catch(error => { lastError = error.message || String(error); });
        return result;
    };
    function token(key) {
        if (!versions.has(key)) versions.set(key, ++nextVersion);
        const version = versions.get(key);
        for (const candidate of versions.keys()) {
            if (versions.size <= Math.max(8, maxCount * 8)) break;
            if (candidate !== key && !aliases.has(candidate) && !flights.has(candidate)) versions.delete(candidate);
        }
        return `${epoch}:${version}`;
    }
    const revoke = entry => {
        if (entry.url?.startsWith('blob:')) globalObject.URL?.revokeObjectURL?.(entry.url);
        urlOwners.delete(entry.url);
    };
    function evict(identity) {
        const entry = memory.get(identity);
        if (!entry) return;
        revoke(entry); memory.delete(identity);
        for (const [key, id] of aliases) if (id === identity) aliases.delete(key);
    }
    function trimMemory() {
        let bytes = [...memory.values()].reduce((sum, entry) => sum + entry.bytes, 0);
        const visible = new Set([...aliases].filter(([key]) => pins.has(key)).map(([, identity]) => identity));
        for (const [id, entry] of memory) {
            if (memory.size <= maxCount && bytes <= memoryBytes) break;
            if (visible.has(id) && bytes <= memoryBytes) continue;
            bytes -= entry.bytes; evict(id);
        }
    }
    function remember(path, value) {
        if (destroyed) return '';
        const key = normalizeImagePath(path);
        if (!key || !value) return '';
        const oldIdentity = aliases.get(key);
        const identity = urlOwners.get(value) || (typeof value === 'string' ? `${imageFingerprint(value)}:${value.length}` : key);
        let entry = memory.get(identity);
        if (!entry) {
            let data = value;
            if (typeof value === 'string') {
                try { data = dataUrlBlob(value, globalObject) || value; } catch { data = value; }
            }
            entry = { data, bytes: typeof data === 'string' ? data.length * 2 : Number.isFinite(data.size) ? data.size : dataUrlBytes(value), url: '', usedAt: now() };
            if (typeof data === 'string') entry.url = data;
            else if (globalObject.URL?.createObjectURL) entry.url = globalObject.URL.createObjectURL(data);
        }
        memory.delete(identity); memory.set(identity, entry); aliases.set(key, identity);
        if (entry.url) urlOwners.set(entry.url, identity);
        if (oldIdentity && oldIdentity !== identity && ![...aliases.values()].includes(oldIdentity)) evict(oldIdentity);
        for (const candidate of aliases.keys()) {
            if (aliases.size <= maxCount * 4 + pins.size) break;
            if (!pins.has(candidate) && !flights.has(candidate)) aliases.delete(candidate);
        }
        trimMemory();
        return memory.has(identity) ? entry.url : (typeof value === 'string' && !value.startsWith('blob:') ? value : '');
    }
    function peek(path) {
        const entry = memory.get(aliases.get(normalizeImagePath(path)));
        if (!entry) return '';
        const id = aliases.get(normalizeImagePath(path));
        memory.delete(id); memory.set(id, entry); entry.usedAt = now();
        return entry.url || '';
    }
    async function metadata(refresh = false) {
        if (!meta || refresh) meta = new Map((await store.allMeta()).map(row => [row.path, { ...row, bytes: Math.max(0, Number(row.bytes) || 0), usedAt: Number(row.usedAt) || 0 }]));
        return meta;
    }
    async function trimDisk() {
        const rows = await metadata(true);
        const sorted = [...rows.values()].sort((a, b) => a.usedAt - b.usedAt);
        for (const row of sorted) {
            const usage = diskUsage(rows);
            if (usage.count <= maxCount && usage.bytes <= maxBytes && rows.size <= maxCount * 4) break;
            await store.delete(row.path); rows.delete(row.path);
        }
        trimMemory();
    }
    async function get(path) {
        if (destroyed) return '';
        const key = normalizeImagePath(path), stamp = token(key);
        const entry = memory.get(aliases.get(key));
        if (entry) {
            peek(key);
            const usedAt = now();
            if (meta?.has(key)) meta.get(key).usedAt = usedAt;
            void enqueue(() => store.touch(key, usedAt)).catch(() => {});
            const value = await blobDataUrl(entry.data, globalObject, { signal: readController?.signal }).catch(error => { if (token(key) !== stamp || destroyed) return ''; throw error; });
            return token(key) === stamp && !destroyed ? value : '';
        }
        const data = await enqueue(() => store.get(key));
        if (!data || token(key) !== stamp) return '';
        const value = await blobDataUrl(data, globalObject, { signal: readController?.signal }).catch(error => { if (token(key) !== stamp || destroyed) return ''; throw error; });
        if (token(key) !== stamp) return '';
        remember(key, value);
        await enqueue(async () => {
            if (token(key) !== stamp) return;
            const rows = await metadata(true);
            if (rows.has(key)) {
                const bytes = typeof data === 'string' ? dataUrlBytes(data) : Number.isFinite(data.size) ? data.size : dataUrlBytes(value);
                rows.get(key).usedAt = now(); rows.get(key).bytes = bytes;
                await store.touch(key, now(), bytes);
            }
            await trimDisk();
        });
        return token(key) === stamp && !destroyed ? value : '';
    }
    async function put(path, value, expectedToken = token(normalizeImagePath(path))) {
        const key = normalizeImagePath(path);
        if (destroyed || !key || !value || token(key) !== expectedToken) return false;
        remember(key, value);
        const entry = memory.get(aliases.get(key));
        const data = entry?.data || value;
        const identity = aliases.get(key) || `${imageFingerprint(value)}:${value.length}`;
        const bytes = typeof data === 'string' ? dataUrlBytes(data) : Number.isFinite(data.size) ? data.size : dataUrlBytes(value);
        await enqueue(async () => {
            if (token(key) !== expectedToken) return;
            await store.put(key, data, now(), bytes, identity);
            (await metadata()).set(key, { path: key, identity, usedAt: now(), bytes });
            await trimDisk();
        });
        channel?.postMessage({ type: 'drop', key });
        return token(key) === expectedToken;
    }
    async function load(path, loader, { persist = true, timeoutMs = 30000, download = false } = {}) {
        if (destroyed) return '';
        const key = normalizeImagePath(path);
        if (flights.has(key)) return flights.get(key).promise;
        const stamp = token(key);
        const controller = Abort ? new Abort() : null;
        let timer;
        let cancel;
        const cancelled = new Promise(resolve => { cancel = () => { controller?.abort(); resolve(''); }; });
        const pending = { controller, cancel, promise: null };
        const work = (async () => {
            const present = memory.get(aliases.get(key));
            const hit = present ? await blobDataUrl(present.data, globalObject, { signal: controller?.signal }) : persist ? await get(key).catch(() => '') : '';
            if (hit) return token(key) === stamp && !destroyed ? hit : '';
            if (token(key) !== stamp) return '';
            const value = await (download ? downloads.run(loader, controller?.signal) : loader(controller?.signal));
            if (token(key) !== stamp || !value) return '';
            if (persist) await put(key, value, stamp).catch(error => { lastError = error.message || String(error); }); else remember(key, value);
            return token(key) === stamp && !destroyed ? value : '';
        })();
        pending.promise = Promise.race([work, cancelled, new Promise((_, reject) => {
            timer = (globalObject.setTimeout || setTimeout)(() => { forget(key); reject(new Error('image-load-timeout')); }, timeoutMs); timer?.unref?.();
        })]).finally(() => {
            (globalObject.clearTimeout || clearTimeout)(timer);
            if (flights.get(key) === pending) flights.delete(key);
        });
        flights.set(key, pending);
        return pending.promise;
    }
    function forget(path) {
        const key = normalizeImagePath(path);
        versions.set(key, ++nextVersion);
        flights.get(key)?.cancel(); flights.delete(key);
        const identity = aliases.get(key); aliases.delete(key);
        if (identity && ![...aliases.values()].includes(identity)) evict(identity);
    }
    async function clear({ memoryOnly = false, broadcast = true, notify = true } = {}) {
        epoch += 1;
        readController?.abort(); readController = Abort && !destroyed ? new Abort() : null;
        for (const pending of flights.values()) pending.cancel();
        flights.clear(); versions.clear();
        for (const id of [...memory.keys()]) evict(id);
        aliases.clear();
        const cleared = !memoryOnly ? enqueue(async () => { await store.clear(); meta = new Map(); }) : Promise.resolve();
        if (notify) for (const listener of listeners) { try { listener(epoch); } catch (error) { lastError = error.message || String(error); } }
        await cleared;
        if (broadcast) channel?.postMessage({ type: 'clear' });
    }
    return {
        get, put, load, peek, remember, forget, token: path => token(normalizeImagePath(path)),
        sourceId: url => { const identity = urlOwners.get(url); const matches = [...aliases].filter(([, id]) => id === identity).map(([key]) => key); return matches.find(key => key.startsWith('thumb:asset:')) || matches.find(key => key.startsWith('asset:')) || matches[0] || ''; },
        async drop(path) { const key = normalizeImagePath(path); forget(key); channel?.postMessage({ type: 'drop', key }); await enqueue(async () => { await store.delete(key); (await metadata()).delete(key); }); },
        async dropPrefix(prefix) {
            const keys = new Set([...aliases.keys()].filter(key => key.startsWith(prefix)));
            for (const key of (await enqueue(metadata)).keys()) if (key.startsWith(prefix)) keys.add(key);
            for (const key of keys) { forget(key); await enqueue(async () => { await store.delete(key); (await metadata()).delete(key); }); channel?.postMessage({ type: 'drop', key }); }
        },
        clear,
        pin(path) {
            if (destroyed) return () => {};
            const key = normalizeImagePath(path); pins.set(key, (pins.get(key) || 0) + 1);
            let released = false;
            return () => { if (released) return; released = true; const count = (pins.get(key) || 0) - 1; if (count > 0) pins.set(key, count); else pins.delete(key); trimMemory(); };
        },
        async destroy() { destroyed = true; pins.clear(); listeners.clear(); channel?.close(); await clear({ memoryOnly: true, broadcast: false, notify: false }); await serial; await store.close?.(); },
        async setMaxCount(value) { maxCount = normalizeImageCacheCount(value); trimMemory(); await enqueue(trimDisk).catch(() => {}); return maxCount; },
        onClear(listener) { listeners.add(listener); return () => listeners.delete(listener); },
        async stats() {
            const rows = await enqueue(() => metadata(true)).catch(() => new Map());
            const disk = diskUsage(rows);
            return { epoch, memoryCount: memory.size, memoryBytes: [...memory.values()].reduce((s, e) => s + e.bytes, 0),
                diskCount: disk.count, diskBytes: disk.bytes, diskAliases: rows.size, pending: flights.size,
                maxCount, memoryBudget: memoryBytes, diskBudget: maxBytes, activeCount: new Set([...aliases].filter(([key]) => pins.has(key)).map(([, identity]) => identity)).size, downloads: downloads.stats(), lastError };
        },
        size: () => memory.size,
    };
}

export function localImageCacheFor(globalObject = globalThis) {
    const key = globalObject || globalThis;
    if (!caches.has(key)) caches.set(key, createLocalImageCache(key));
    return caches.get(key);
}

export function disposeLocalImageCache(globalObject) {
    const cache = caches.get(globalObject); caches.delete(globalObject);
    return cache?.destroy();
}
