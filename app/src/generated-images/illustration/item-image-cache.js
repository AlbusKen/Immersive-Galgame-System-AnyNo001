import { createLocalImageCache } from '../../media/tavern-image-cache.js';
// 物品图记录与图片的按聊天缓存：只读本地存储，不联网；同步取图未命中时异步补载并发事件通知重绘。
export function createItemRecordCache({ store, type, emit, mediaCache }) {
    const images = mediaCache || createLocalImageCache({});
    const keyOf = id => `asset:${id}`;
    const pending = new Set();
    let chatId = '';
    let records = new Map();
    let loading = null;

    function rememberImage(id, dataUrl) { images.remember(keyOf(id), dataUrl); }

    function ensure(nextChatId) {
        if (nextChatId !== chatId) { chatId = nextChatId; records = new Map(); loading = null; }
        if (!loading) {
            const target = chatId;
            loading = Promise.resolve(store.getAssetsByChat(target)).then((list) => {
                if (chatId !== target) return;
                let found = false;
                for (const record of list || []) {
                    // 已在内存里的记录更新（本轮刚生成），不被旧快照覆盖。
                    if (record && record.type === type && !records.has(record.key)) { records.set(record.key, record); found = true; }
                }
                if (found) emit({ chatId: target, reason: 'hydrated' });
            }).catch(() => { if (chatId === target) loading = null; });
        }
        return loading;
    }

    const get = (targetChatId, key) => (targetChatId === chatId ? records.get(key) || null : null);
    const list = (targetChatId) => (targetChatId === chatId ? Array.from(records.values()) : []);
    function set(record) {
        if (record && record.chatId === chatId) records.set(record.key, record);
    }

    // 同步取图：命中内存直接返回，否则异步从存储补载，补完后发 image-loaded。
    function imageUrl(imageId) {
        if (!imageId) return '';
        const hit = images.peek(keyOf(imageId));
        if (hit) return hit;
        if (!pending.has(imageId)) {
            pending.add(imageId);
            const stamp = images.token(keyOf(imageId));
            images.load(keyOf(imageId), async () => (await store.getImage(imageId, { fields: ['dataUrl'] }))?.dataUrl || '', { persist: false }).then(value => {
                if (value && images.token(keyOf(imageId)) === stamp) emit({ imageId, reason: 'image-loaded' });
            }).catch(() => {}).finally(() => pending.delete(imageId));
        }
        return '';
    }

    async function dropImage(imageId) {
        if (!imageId) return;
        const result = await store.deleteImage(imageId);
        if (result?.ok === false) throw new Error(result.reason || 'image-delete-failed');
        if (!result?.retained?.length) images.forget(keyOf(imageId));
        return result;
    }

    return { ensure, get, set, list, imageUrl, rememberImage, dropImage, clear() { pending.clear(); records.clear(); chatId = ''; loading = null; } };
}
