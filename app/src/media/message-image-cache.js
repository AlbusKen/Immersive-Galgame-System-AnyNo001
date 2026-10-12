import { createLocalImageCache } from './tavern-image-cache.js';
import { imageFingerprint, isImageData } from './image-identity.js';
export function createMessageImageCache(store = new Map(), options = {}) {
    const media = options.mediaCache || createLocalImageCache({});
    const limit = options.limit || 128;
    let epoch = 0;
    const keyOf = (id, scope = {}) => JSON.stringify([String(scope.chatId || ''), id, Number(scope.swipeId) || 0, String(scope.revision || '')]);
    const offClear = media.onClear(() => { epoch += 1; store.clear(); });
    return {
        epoch: () => epoch,
        destroy() { offClear(); store.clear(); epoch += 1; },
        get(messageId, scope) {
            const normalizedId = normalizeMessageId(messageId);
            if (normalizedId == null) return null;
            const key = keyOf(normalizedId, scope), entry = store.get(key);
            if (entry) { store.delete(key); store.set(key, entry); }
            return cloneData(entry || null);
        },

        remember(messageId, images, options = {}) {
            const normalizedId = normalizeMessageId(messageId);
            if (normalizedId == null) {
                return { ok: false, reason: 'invalid-message-id', messageId };
            }
            const key = keyOf(normalizedId, options.scope);
            const nextImages = normalizeImages(images).map(image => isImageData(image.url) ? { ...image, url: media.remember(`external:${imageFingerprint(image.url)}`, image.url) } : image);
            const current = store.get(key);
            const merged = options.merge === true && current
                ? uniqueImages([...(current.images || []), ...nextImages])
                : nextImages;
            const entry = createEntry(normalizedId, merged);
            store.set(key, entry);
            while (store.size > limit) store.delete(store.keys().next().value);
            return { ok: true, entry: cloneData(entry) };
        },

        clearMessage(messageId, scope) {
            const normalizedId = normalizeMessageId(messageId);
            if (normalizedId == null) return { ok: false, reason: 'invalid-message-id', messageId };
            return { ok: store.delete(keyOf(normalizedId, scope)), messageId: normalizedId };
        },

        clear() {
            epoch += 1; store.clear();
            return { ok: true };
        },
    };
}

function createEntry(messageId, images) {
    const normalizedImages = normalizeImages(images);
    return {
        messageId,
        images: normalizedImages,
        count: normalizedImages.length,
        signature: createImageSignature(normalizedImages),
    };
}

function normalizeImages(images) {
    const source = Array.isArray(images) ? images : [];
    return uniqueImages(source.map((image) => {
        if (!image || typeof image !== 'object') return null;
        const url = String(image.url || '').trim();
        if (!url) return null;
        return {
            url,
            providerId: String(image.providerId || '').trim(),
            source: String(image.source || '').trim(),
            filename: String(image.filename || '').trim(),
            imageId: String(image.imageId || '').trim(),
            locationHash: String(image.locationHash || '').trim(),
            slotIndex: normalizeOptionalIndex(image.slotIndex),
            buttonIndex: normalizeOptionalIndex(image.buttonIndex),
            order: normalizeOptionalIndex(image.order),
        };
    }).filter(Boolean));
}

function uniqueImages(images) {
    const output = [];
    const seen = new Map();
    for (const image of Array.isArray(images) ? images : []) {
        const url = String(image && image.url || '').trim();
        if (!url) continue;
        const nextImage = {
            url,
            providerId: String(image.providerId || '').trim(),
            source: String(image.source || '').trim(),
            filename: String(image.filename || '').trim(),
            imageId: String(image.imageId || '').trim(),
            locationHash: String(image.locationHash || '').trim(),
            slotIndex: normalizeOptionalIndex(image.slotIndex),
            buttonIndex: normalizeOptionalIndex(image.buttonIndex),
            order: normalizeOptionalIndex(image.order),
        };
        const existingIndex = seen.get(url);
        if (existingIndex == null) {
            seen.set(url, output.length);
            output.push(nextImage);
            continue;
        }
        output[existingIndex] = mergeImageMetadata(output[existingIndex], nextImage);
    }
    return output;
}

function createImageSignature(images) {
    return imageFingerprint(uniqueImages(images).map((image) => image.url).join('\n'));
}

function normalizeMessageId(value) {
    const id = Number(value);
    if (!Number.isFinite(id) || id < 0) return null;
    return id;
}

function cloneData(value) {
    if (value == null) return value;
    if (Array.isArray(value)) return value.map(cloneData);
    if (typeof value === 'object') {
        return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cloneData(item)]));
    }
    return value;
}

function mergeImageMetadata(current, next) {
    return {
        ...current,
        ...next,
        providerId: current.providerId || next.providerId,
        source: current.source || next.source,
        filename: current.filename || next.filename,
        imageId: current.imageId || next.imageId,
        locationHash: current.locationHash || next.locationHash,
        slotIndex: current.slotIndex ?? next.slotIndex ?? null,
        buttonIndex: current.buttonIndex ?? next.buttonIndex ?? null,
        order: current.order ?? next.order ?? null,
    };
}

function normalizeOptionalIndex(value) {
    if (value == null || value === '') return null;
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric < 0) return null;
    return Math.floor(numeric);
}
