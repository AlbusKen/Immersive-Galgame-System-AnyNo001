// 角色 DNA：结构化文本角色资料的规范化、别名解析与提示词片段合并。
// 数据位于 sceneAssets.characterDna，与情绪槽映射 sceneAssets.characters 并列，互不混入。

export const CHARACTER_DNA_FIELDS = Object.freeze(['identity', 'defaultAppearance', 'negative', 'triggerWords']);
export const CHARACTER_DNA_REQUIRED_VIEWS = Object.freeze(['full_body', 'half_body', 'portrait']);
// partial 只兼容历史资料与明确的旧任务，不参与新建完整性要求。
export const CHARACTER_DNA_VIEWS = Object.freeze(['full_body', 'half_body', 'portrait', 'partial']);
export const CHARACTER_DNA_EDIT_FIELDS = Object.freeze([...CHARACTER_DNA_FIELDS,
    ...CHARACTER_DNA_VIEWS.flatMap((view) => [`views.${view}.subject`, `views.${view}.negative`])]);

// 景别资料是同一身份的不同取景文本，不从旧自由文本自动推导。
export function checkDnaViews(raw, { complete = false, allowEmpty = false } = {}) {
    const fail = () => ({ ok: false, reason: 'DNA_VIEW_INVALID', error: '景别 DNA 格式无效' });
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)
        || Object.keys(raw).some((key) => !CHARACTER_DNA_VIEWS.includes(key))) return fail();
    const value = {};
    for (const view of CHARACTER_DNA_VIEWS) {
        const item = raw[view];
        if (item === undefined && (!complete || !CHARACTER_DNA_REQUIRED_VIEWS.includes(view))) continue;
        if (!item || typeof item !== 'object' || Array.isArray(item)
            || typeof item.subject !== 'string' || (!allowEmpty && !item.subject.trim()) || item.subject.length > 4096
            || (item.negative !== undefined && (typeof item.negative !== 'string' || item.negative.length > 4096))
            || /<<dna(?:_uc)?:/i.test(item.subject + (item.negative || ''))) return fail();
        value[view] = { subject: cleanText(item.subject), negative: cleanText(item.negative) };
    }
    return { ok: true, value };
}

export function readCharacterDnaView(raw, framing) {
    if (!CHARACTER_DNA_VIEWS.includes(framing)) return { ok: false, reason: 'DNA_VIEW_INVALID', error: '未知人物景别' };
    const dna = normalizeCharacterDna(raw);
    if (!dna.identity && !CHARACTER_DNA_VIEWS.some((view) => dna.views?.[view]?.subject))
        return { ok: false, reason: 'DNA_MISSING', error: dna.identityInitialized
            ? '角色身份已手工清空，请先补齐 DNA' : '角色缺少 DNA，请先生成立绘' };
    if (raw?.version !== undefined && raw.version !== 2)
        return { ok: false, reason: 'DNA_VIEW_INVALID', error: '未知 DNA 版本' };
    if (raw?.version !== 2 || raw?.views === undefined)
        return { ok: false, reason: 'DNA_VIEW_MISSING', error: '角色缺少对应景别 DNA，请通过立绘补齐' };
    const checked = checkDnaViews(raw.views, { allowEmpty: true });
    if (!checked.ok) return checked;
    if (!checked.value[framing]?.subject) return { ok: false, reason: 'DNA_VIEW_MISSING', error: '角色缺少对应景别 DNA，请通过立绘补齐' };
    return { ok: true, value: checked.value[framing] };
}

export function editCharacterDnaField(raw, field, value) {
    if (!CHARACTER_DNA_EDIT_FIELDS.includes(field) || typeof value !== 'string') return null;
    const next = { ...normalizeCharacterDna(raw) };
    if (CHARACTER_DNA_FIELDS.includes(field)) {
        next[field] = value;
        if (field === 'identity') next.identityInitialized = true;
    } else {
        const [, view, part] = field.split('.');
        next.version = 2;
        next.views = { ...next.views, [view]: { subject: '', negative: '', ...next.views?.[view], [part]: value } };
        // 手工编辑身份（包括主动清空）锁定资料；只填负面词不阻止首次立绘建档。
        if (part === 'subject') next.identityInitialized = true;
    }
    return next;
}

// 预设与导入文件属于不可信输入，拒绝原型污染键。
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
const plainObject = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);

function cleanText(value) {
    return typeof value === 'string' ? value.replace(/\r\n?/g, '\n').trim() : '';
}

export function normalizeCharacterDna(raw) {
    const source = plainObject(raw) || {};
    const dna = {};
    for (const field of CHARACTER_DNA_FIELDS) dna[field] = cleanText(source[field]);
    if (source.identityInitialized === true) dna.identityInitialized = true;
    if (typeof source.identitySource === 'string' && source.identitySource) dna.identitySource = source.identitySource;
    if (source.version === 2) {
        dna.version = 2;
        dna.views = {};
        for (const view of CHARACTER_DNA_VIEWS) {
            const item = plainObject(source.views?.[view]);
            if (item) dna.views[view] = { subject: cleanText(item.subject), negative: cleanText(item.negative) };
        }
    }
    return dna;
}

export function isCharacterDnaEmpty(dna) {
    return CHARACTER_DNA_FIELDS.every((field) => !cleanText(dna?.[field]))
        && CHARACTER_DNA_VIEWS.every((view) => !cleanText(dna?.views?.[view]?.subject));
}

// 空记录保留：DNA-only 角色可以先登记名字、后补资料。
export function normalizeCharacterDnaMap(raw) {
    const out = {};
    const source = plainObject(raw);
    if (!source) return out;
    for (const [key, value] of Object.entries(source)) {
        const name = cleanText(key);
        if (!name || FORBIDDEN_KEYS.has(name) || hasOwn(out, name)) continue;
        out[name] = normalizeCharacterDna(value);
    }
    return out;
}

// resolveCanonical 由调用方注入既有别名归约，不维护第二套身份解析。
export function resolveCharacterDna(dnaMap, name, resolveCanonical) {
    const raw = cleanText(name);
    const map = plainObject(dnaMap);
    if (!raw || !map) return null;
    const mapped = typeof resolveCanonical === 'function' ? cleanText(resolveCanonical(raw)) : '';
    const canonical = mapped || raw;
    const key = hasOwn(map, canonical) ? canonical : (hasOwn(map, raw) ? raw : '');
    if (!key) return null;
    return { name: key, dna: normalizeCharacterDna(map[key]) };
}

// 改名保序迁移；目标名已有 DNA 时拒绝，避免覆盖另一角色资料。
export function renameCharacterDna(dnaMap, oldName, newName) {
    const map = plainObject(dnaMap) || {};
    const target = cleanText(newName);
    if (!target || FORBIDDEN_KEYS.has(target)) return { ok: false, reason: 'invalid-name', map };
    if (!hasOwn(map, oldName) || target === oldName) return { ok: true, map };
    if (hasOwn(map, target)) return { ok: false, reason: 'name-exists', map };
    const next = {};
    for (const [key, value] of Object.entries(map)) next[key === oldName ? target : key] = value;
    return { ok: true, map: next };
}

export function removeCharacterDna(dnaMap, name) {
    const map = plainObject(dnaMap) || {};
    if (!hasOwn(map, name)) return map;
    const next = { ...map };
    delete next[name];
    return next;
}

// 按顶层逗号/换行切分；括号内的逗号属于权重语法，不切分。
export function splitPromptTags(text) {
    const tags = [];
    let depth = 0;
    let buf = '';
    for (const ch of cleanText(text)) {
        if ('([{'.includes(ch)) depth += 1;
        else if (')]}'.includes(ch)) depth = Math.max(0, depth - 1);
        if (depth === 0 && (ch === ',' || ch === '，' || ch === '\n')) {
            if (buf.trim()) tags.push(buf.trim());
            buf = '';
        } else {
            buf += ch;
        }
    }
    if (buf.trim()) tags.push(buf.trim());
    return tags;
}

// 保序合并并稳定去重（大小写与空白不敏感），不改写单项内容。
export function mergePromptTags(...parts) {
    const seen = new Set();
    const out = [];
    for (const part of parts.flat()) {
        for (const tag of splitPromptTags(part)) {
            const key = tag.toLowerCase().replace(/\s+/g, ' ');
            if (seen.has(key)) continue;
            seen.add(key);
            out.push(tag);
        }
    }
    return out.join(', ');
}

// 固定顺序：triggerWords → identity →（立绘链才追加）defaultAppearance；空字段不注入。
export function buildCharacterDnaPromptParts(dna, { includeDefaultAppearance = false } = {}) {
    const d = normalizeCharacterDna(dna);
    const positive = [d.triggerWords, d.identity];
    if (includeDefaultAppearance) positive.push(d.defaultAppearance);
    return { positive: mergePromptTags(positive), negative: mergePromptTags(d.negative) };
}

