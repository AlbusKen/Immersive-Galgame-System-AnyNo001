import { OUTFIT_RESET, isValidOutfitName, isValidOutfitWord } from './character-outfits.js';
import { migrateSpriteKeys } from '../visual/igs-ui/sprite-key-migration.js';

const plain = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);

// 原装的「默认」立绘没有表情。服装里承担同一角色的是「平和」——它本来就是这套衣服缺图时的
// 兜底槽，语义正好接得上，所以默认那张搬进平和，而不是新建一个服装不能有的「默认」槽。
export const MIGRATED_BASE_SLOT = '平和';

function takenOutfitWords(outfits, except) {
    const taken = new Set();
    for (const [name, entry] of Object.entries(outfits)) {
        if (name === except) continue;
        taken.add(name);
        for (const word of Array.isArray(entry && entry.words) ? entry.words : []) taken.add(word);
    }
    return taken;
}

// 「、，,；;　 」这类都当分隔，别名一次可以填好几个。
export function splitMigrationWords(value) {
    const out = [];
    for (const raw of String(value || '').split(/[、,，;；\s]+/)) {
        const word = raw.trim();
        if (word && !out.includes(word)) out.push(word);
    }
    return out;
}

// 原装立绘整体搬成一套差分服装（含同名衣柜条目），并把原装清空。
// 逐层写时浅拷：不原地改上层共享的存储对象，只替换到该动的那个键。
// rows 每条：{ character, name, words?: string[], note?: string, prompt?: string }，name 为空的整条跳过。
export function migrateOriginalOutfits({ sceneAssets, readerSettings, rows } = {}) {
    const assets = plain(sceneAssets);
    if (!assets) return { ok: false, reason: 'no-assets', done: [], skipped: [] };
    let characters = plain(assets.characters) || {};
    let characterOutfits = plain(assets.characterOutfits) || {};
    let wardrobe = plain(assets.wardrobe) || {};
    let generated = plain(assets.generated) || {};
    let notes = plain(generated.expressionNotes) || {};
    const done = [];
    const skipped = [];
    for (const row of Array.isArray(rows) ? rows : []) {
        const character = String((row && row.character) || '').trim();
        const name = String((row && row.name) || '').trim();
        if (!character) continue;
        if (!name) { skipped.push({ character, name, reason: '未填服装名' }); continue; }
        const base = plain(characters[character]);
        if (!base) { skipped.push({ character, name, reason: '已不是登记角色' }); continue; }
        if (!isValidOutfitName(name)) { skipped.push({ character, name, reason: '「默认」「原装」不能当服装名，也不能含 | ] 换行' }); continue; }
        const outfits = plain(characterOutfits[character]) || {};
        if (plain(outfits[name])) { skipped.push({ character, name, reason: `「${character}」已有服装「${name}」` }); continue; }

        const filled = Object.entries(base).filter(([, url]) => String(url || '').trim());
        const defaults = String(base[OUTFIT_RESET] || '').trim();
        const replacedCalm = Boolean(defaults && String(base[MIGRATED_BASE_SLOT] || '').trim());
        const moods = {};
        if (defaults) moods[MIGRATED_BASE_SLOT] = String(base[MIGRATED_BASE_SLOT] || '').trim() || defaults;
        for (const [slot, url] of filled) {
            if (slot === OUTFIT_RESET || slot === MIGRATED_BASE_SLOT) continue;
            moods[slot] = String(url).trim();
        }

        const taken = takenOutfitWords(outfits, name);
        const words = [];
        for (const raw of Array.isArray(row.words) ? row.words : []) {
            const word = String(raw || '').trim();
            if (!word || word === name || words.includes(word)) continue;
            if (!isValidOutfitWord(word) || word === OUTFIT_RESET) continue;
            if (taken.has(word)) continue;
            words.push(word);
        }
        const entry = { words, moods };
        const note = String(row.note || '').trim();
        if (note) entry.note = note;
        // 服装点名引用衣柜条目：显式写死，之后改衣柜条目名或服装名都不会各走各的。
        entry.wardrobe = name;
        // 衣柜条目同批建出来，提示词是原装默认立绘上存的那份（取不到就留空）。
        const prompt = String(row.prompt || '').trim();
        const existing = plain(wardrobe[name]);
        if (!existing) wardrobe = { ...wardrobe, [name]: { prompt } };
        else if (prompt && !String(existing.prompt || '').trim()) wardrobe = { ...wardrobe, [name]: { ...existing, prompt } };

        characterOutfits = { ...characterOutfits, [character]: { ...outfits, [name]: entry } };
        // 原装清空。角色本身留在列表里（角色卡不该消失），只是没有立绘了。
        characters = { ...characters, [character]: {} };
        // 表情注记跟着换身份键；同键合并时新写的盖过原装的。
        if (plain(notes[character])) {
            const key = `${character}\u0001${name}`;
            notes = { ...notes, [key]: { ...(plain(notes[key]) || {}), ...notes[character] } };
            delete notes[character];
        }
        // 「调整立绘」存的位置与头部标定：先把默认那张的槽名改成平和（身份不动），再把原装整体搬进这套服装。
        // 两步必须分开——合成一步的话，改槽名会把这套衣服的每个槽都改名成平和。
        migrateSpriteKeys(readerSettings, { character, outfit: '', mood: OUTFIT_RESET }, { mood: MIGRATED_BASE_SLOT });
        migrateSpriteKeys(readerSettings, { character, outfit: '' }, { outfit: name });

        done.push({ character, name, moods: Object.keys(moods).length, cleared: filled.length, replacedCalm });
    }
    assets.characters = characters;
    assets.characterOutfits = characterOutfits;
    assets.wardrobe = wardrobe;
    assets.generated = { ...generated, expressionNotes: notes };
    return { ok: true, done, skipped };
}

// 迁移清单的一行：说明这个角色是「整套有图」还是「只有默认」，以及会搬走几张。
export function migrationRowOf(character, base) {
    const record = plain(base) || {};
    const filled = Object.entries(record).filter(([, url]) => String(url || '').trim());
    const defaults = String(record[OUTFIT_RESET] || '').trim();
    const others = filled.filter(([slot]) => slot !== OUTFIT_RESET);
    return {
        character,
        count: filled.length,
        hasSprite: Boolean(defaults),
        whole: others.length > 0 && Boolean(defaults),
        stat: others.length ? `整套 ${filled.length} 张` : '仅默认',
    };
}
