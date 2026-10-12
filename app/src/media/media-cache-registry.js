// 可再生的元数据和任务索引统一登记；此层不导入业务模块，也不保存图片像素。
export const MEDIA_CACHE_POLICIES = Object.freeze({
    messages: { purpose: '消息与图片的对应关系', maxEntries: 128 },
    'asset-records': { purpose: '当前聊天临时素材记录', maxScopes: 1, retention: 'current-chat' },
    'item-records': { purpose: '当前聊天物品记录', maxScopes: 1, retention: 'current-chat' },
    'cg-states': { purpose: 'CG 槽位状态与短期缺图结果', maxEntries: 320, failureTtlMs: 1000, ttlFor: value => value.hasImage ? 0 : 1000 },
    maps: { purpose: '地图生成任务和结果索引', maxEntries: 4, failureTtlMs: 30000, ttlFor: value => value.status === 'failed' ? 30000 : 0 },
    'sprite-geometry': { purpose: '立绘尺寸、头部和脚底探测结果', maxEntries: 48 },
    'sprite-failures': { purpose: '立绘探测失败，抑制反复解码', maxEntries: 48, ttlMs: 30000 },
    'sprite-probes': { purpose: '立绘在途探测去重', maxEntries: 48, retention: 'in-flight' },
    'cg-failures': { purpose: 'CG 缩略图失败，抑制反复读图', maxEntries: 320, ttlMs: 30000 },
    'cg-catalogue': { purpose: '当前 CG 库视图目录和任务', maxScopes: 1, retention: 'view' },
    directories: { purpose: '旧图库目录与在途查询', maxEntries: 8, ttlMs: 2000 },
    'reader-sources': { purpose: '阅读器预载的资源键', maxEntries: 96 },
});

export function createMediaCacheRegistry({ now = () => Date.now() } = {}) {
    const owners = new Map(), shared = new Map();
    let sequence = 0, destroyed = false, lastError = '';
    const invoke = (fn, ...args) => {
        try { fn?.(...args); } catch (error) { lastError = error.message || String(error); }
    };
    function policyFor(name, options) {
        const policy = MEDIA_CACHE_POLICIES[name];
        if (!policy) throw new Error(`unknown-media-cache:${name}`);
        return { ttlMs: 0, retention: 'lru', ...policy,
            ...(options.maxEntries != null ? { maxEntries: Math.max(1, Math.floor(Number(options.maxEntries) || policy.maxEntries || 1)) } : {}) };
    }
    function register(name, options = {}) {
        const policy = policyFor(name, options), id = `${name}:${++sequence}`;
        const entry = { id, name, policy, ...options };
        let disposed = false;
        const handle = {
            policy,
            clear(reason = 'clear') { if (!disposed) invoke(options.clear, reason); },
            destroy() {
                if (disposed) return;
                disposed = true; owners.delete(id);
                invoke(options.clear, 'destroy'); invoke(options.destroy);
            },
        };
        if (destroyed) handle.destroy(); else owners.set(id, { ...entry, handle });
        return handle;
    }
    function createMap(name, options = {}) {
        const policy = policyFor(name, options), records = options.store || new Map(), deadlines = new Map();
        const clock = options.now || now;
        let generation = 0, disposed = false;
        function remove(key, reason) {
            if (!records.has(key)) return false;
            const value = records.get(key); records.delete(key); deadlines.delete(key);
            invoke(options.onRemove, value, key, reason);
            return true;
        }
        const prune = () => {
            for (const [key, expiresAt] of deadlines) if (expiresAt <= clock()) remove(key, 'expired');
        };
        const clear = reason => {
            generation += 1;
            for (const key of [...records.keys()]) remove(key, reason);
            invoke(options.onClear, reason);
        };
        const handle = register(name, { ...options, clear, destroy: () => { disposed = true; invoke(options.onDestroy); },
            stats: () => { prune(); return { count: records.size, pending: [...records.values()].filter(value => value?.status === 'pending').length }; } });
        const api = {
            get size() { prune(); return records.size; },
            get(key) {
                prune();
                if (!records.has(key)) return undefined;
                const value = records.get(key); records.delete(key); records.set(key, value);
                return value;
            },
            has(key) { prune(); return records.has(key); },
            set(key, value, { ttlMs = policy.ttlFor?.(value) ?? policy.ttlMs } = {}) {
                if (disposed) return api;
                prune();
                if (records.has(key) && records.get(key) !== value) remove(key, 'replaced');
                records.delete(key); records.set(key, value);
                if (ttlMs > 0) deadlines.set(key, clock() + ttlMs); else deadlines.delete(key);
                while (records.size > policy.maxEntries) remove(records.keys().next().value, 'capacity');
                return api;
            },
            delete: key => remove(key, 'delete'),
            clear: () => clear('clear'),
            destroy: handle.destroy,
            epoch: () => generation,
            keys() { prune(); return records.keys(); },
            values() { prune(); return records.values(); },
            entries() { prune(); return records.entries(); },
            [Symbol.iterator]() { return api.entries(); },
        };
        return api;
    }
    function sharedMap(name, options) {
        if (!shared.has(name)) shared.set(name, createMap(name, options));
        return shared.get(name);
    }
    // 单个聊天的完整元数据快照：不能按行随意淘汰，否则会误判已有素材为缺图并重复生图。
    function scopedRecords(name, { filter = () => true, onHydrated, onClear, pendingCount = () => 0 } = {}) {
        const records = new Map();
        let scope = '', generation = 0, loading = null, loaded = false, disposed = false;
        const clear = () => { generation += 1; records.clear(); scope = ''; loading = null; loaded = false; invoke(onClear); };
        const handle = register(name, { clear, destroy: () => { disposed = true; },
            stats: () => ({ count: records.size, activeScopes: scope ? 1 : 0, pending: (loading ? 1 : 0) + pendingCount() }) });
        return {
            records,
            get scope() { return scope; },
            epoch: () => generation,
            clear, destroy: handle.destroy,
            ensure(nextScope, loader) {
                if (disposed) return Promise.resolve();
                if (nextScope !== scope) { clear(); scope = nextScope; }
                if (loaded || !nextScope) return Promise.resolve();
                if (loading) return loading;
                const stamp = generation;
                const job = Promise.resolve().then(() => loader(nextScope)).then(list => {
                    if (disposed || stamp !== generation) return;
                    let found = false;
                    for (const record of list || []) if (record && filter(record) && !records.has(record.key)) { records.set(record.key, record); found = true; }
                    loaded = true;
                    if (found) invoke(onHydrated, nextScope);
                }).catch(() => {}).finally(() => { if (loading === job) loading = null; });
                loading = job;
                return job;
            },
        };
    }
    return {
        register, createMap, sharedMap, scopedRecords,
        clear() { for (const owner of [...owners.values()]) owner.handle.clear(); },
        destroy() { destroyed = true; for (const owner of [...owners.values()]) owner.handle.destroy(); shared.clear(); },
        stats() {
            const rows = [...owners.values()].map(({ id, name, policy, stats }) => {
                const { ttlFor, ...descriptor } = policy;
                let measured = {};
                try { measured = stats?.() || {}; } catch (error) { lastError = error.message || String(error); }
                return { id, owner: name, ...descriptor, ...measured };
            });
            return { owners: rows, count: rows.length, entries: rows.reduce((sum, row) => sum + (row.count || 0), 0), lastError };
        },
    };
}
