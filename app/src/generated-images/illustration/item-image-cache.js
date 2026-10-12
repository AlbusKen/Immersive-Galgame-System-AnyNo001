import { createLocalImageCache } from '../../media/tavern-image-cache.js';
// 物品图记录与图片的按聊天缓存：只读本地存储，不联网；同步取图未命中时异步补载并发事件通知重绘。
export function createItemRecordCache({ store, type, emit, mediaCache }) {
    const images = mediaCache || createLocalImageCache({});
    const keyOf = id => `asset:${id}`;
    const pending = new Set();
    const metadata = images.auxiliary.scopedRecords('item-records', {
        filter: record => record.type === type,
        onHydrated: chatId => emit({ chatId, reason: 'hydrated' }),
        onClear: () => pending.clear(), pendingCount: () => pending.size,
    });
    const records = metadata.records;

    function rememberImage(id, dataUrl) { images.remember(keyOf(id), dataUrl); }

    function ensure(nextChatId) {
        return metadata.ensure(nextChatId, target => store.getAssetsByChat(target));
    }

    const get = (targetChatId, key) => (targetChatId === metadata.scope ? records.get(key) || null : null);
    const list = (targetChatId) => (targetChatId === metadata.scope ? Array.from(records.values()) : []);
    function set(record) {
        if (record && record.chatId === metadata.scope) records.set(record.key, record);
    }

    // 同步取图：命中内存直接返回，否则异步从存储补载，补完后发 image-loaded。
    function imageUrl(imageId) {
        if (!imageId) return '';
        const hit = images.peek(keyOf(imageId));
        if (hit) return hit;
        if (!pending.has(imageId)) {
            pending.add(imageId);
            const generation = metadata.epoch();
            const stamp = images.token(keyOf(imageId));
            images.load(keyOf(imageId), async () => (await store.getImage(imageId, { fields: ['dataUrl'] }))?.dataUrl || '', { persist: false }).then(value => {
                if (value && metadata.epoch() === generation && images.token(keyOf(imageId)) === stamp) emit({ imageId, reason: 'image-loaded' });
            }).catch(() => {}).finally(() => { if (metadata.epoch() === generation) pending.delete(imageId); });
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

    return { ensure, get, set, list, imageUrl, rememberImage, dropImage, clear: metadata.clear, destroy: metadata.destroy };
}
