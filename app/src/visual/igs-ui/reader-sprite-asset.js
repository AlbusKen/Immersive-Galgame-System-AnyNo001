import { resolveSpriteAsset, isGeneratedAssetUrl, isNonSpriteSpeaker } from '../../scene/asset-match.js';

// 聊天临时显示与正式衣装选择分离；不登记衣装、身份或默认映射。
export function resolveReaderSpriteAsset(character, mood, ctx = {}, outfit = '') {
    const hit = resolveSpriteAsset(character, mood, ctx, outfit);
    const name = String(character || '').trim();
    const requested = String(outfit || '').trim();
    if (hit.url || !name || isNonSpriteSpeaker(name)
        || (requested && !['默认', '原装'].includes(requested))
        || !['appearance-character-missing', 'default-outfit-unset', 'outfit-image-empty', 'outfit-image-missing'].includes(hit.reason)
        || typeof ctx.tempSprite !== 'function') return hit;
    const url = ctx.tempSprite(hit.character || name) || (hit.character !== name ? ctx.tempSprite(name) : '');
    if (!isGeneratedAssetUrl(url)) return hit;
    try {
        if (ctx.isMissingImage?.(url)) return hit;
        const state = typeof ctx.imageAvailability === 'function' ? ctx.imageAvailability(url) : ctx.imageAvailability?.[url];
        const status = typeof state === 'string' ? state : state?.status;
        if (status && !['available', 'unverified', 'loading'].includes(status)) return hit;
    } catch { return hit; }
    return { ...hit, url, slot: '默认', source: 'temp', quality: 'temp',
        outfit: '', selectionSource: 'chat-temp', reason: '', needsGeneration: false };
}
