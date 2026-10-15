import { resolveSpriteAsset, isGeneratedAssetUrl, isNonSpriteSpeaker } from '../../scene/asset-match.js';

// 聊天临时显示与正式衣装选择分离；不登记衣装、身份或默认映射。
export function resolveReaderSpriteAsset(character, mood, ctx = {}, outfit = '') {
    const hit = resolveSpriteAsset(character, mood, ctx, outfit);
    const name = String(character || '').trim();
    const requested = String(outfit || '').trim();
    const explicit = requested && !['默认', '原装'].includes(requested);
    const lookup = explicit ? ctx.tempSpriteForOutfit : ctx.tempSprite;
    if (hit.url || !name || isNonSpriteSpeaker(name)
        || !['appearance-character-missing', 'default-outfit-unset', 'outfit-unregistered', 'outfit-image-empty', 'outfit-image-missing'].includes(hit.reason)
        || typeof lookup !== 'function') return hit;
    const find = key => explicit ? lookup(key, requested) : lookup(key);
    const url = find(hit.character || name) || (hit.character !== name ? find(name) : '');
    if (!isGeneratedAssetUrl(url)) return hit;
    try {
        if (ctx.isMissingImage?.(url)) return hit;
        const state = typeof ctx.imageAvailability === 'function' ? ctx.imageAvailability(url) : ctx.imageAvailability?.[url];
        const status = typeof state === 'string' ? state : state?.status;
        if (status && !['available', 'unverified', 'loading'].includes(status)) return hit;
    } catch { return hit; }
    return { ...hit, url, slot: '默认', source: 'temp', quality: 'temp',
        outfit: explicit ? requested : '', selectionSource: 'chat-temp', reason: '', needsGeneration: false };
}
