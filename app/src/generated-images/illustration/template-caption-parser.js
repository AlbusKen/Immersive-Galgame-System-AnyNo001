// 内置写词的扁平 DNA 旁路解析；只组装协议，不展开身份或加工正文。
import { CHARACTER_DNA_VIEWS } from '../../scene/character-dna.js';
import { checkCharacterMeta } from '../../schemas/character-meta.js';
import { checkPromptTask, checkPromptOutput } from '../../schemas/prompt-recipe.js';

const fields = new Set(['slotid', 'size', 'analysis', 'scene', 'scene_uc', 'prompt_mode', 'outfit_mode', 'char', 'char_uc', 'at']);
const metaFields = new Set(['meta_kind', 'meta_key', 'meta_token', 'meta_frame', 'meta_identity', 'meta_signature',
    'meta_outfit_name', 'meta_outfit_description', 'meta_region',
    ...CHARACTER_DNA_VIEWS.flatMap((f) => [`meta_dna_${f}`, `meta_dna_uc_${f}`])]);
const fail = (reason = 'DNA_TEMPLATE_BINDING') => ({ ok: false, reason, error: '动态模板字段无效，已停止写词交接' });
const side = (base, chars) => ({ caption: { base_caption: base, char_captions: chars } });

export function parseTemplateCaptionSlots(text, { promptTask, characterContext } = {}) {
    const task = checkPromptTask(promptTask, characterContext);
    if (!task.ok) return task;
    if (!task.value) return fail('PROMPT_MODE_CONFLICT');
    const blocks = [], ids = new Set();
    let current = null, last = '';
    for (const line of String(text || '').split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        if (trimmed === '---') { current = null; last = ''; continue; }
        const match = /^(\w+)\s*[:：]\s*(.*)$/.exec(trimmed);
        if (!match) {
            if (current && last === 'analysis') { current.analysis += '\n' + trimmed; continue; }
            return fail();
        }
        const [, key, value] = match;
        if (!fields.has(key) && !metaFields.has(key)) return fail();
        if (key === 'slotid') {
            const slotId = Number(value);
            if (!/^\d+$/.test(value) || !Number.isSafeInteger(slotId) || slotId < 1 || ids.has(slotId)) return fail();
            ids.add(slotId);
            current = { slotId, chars: [], ucs: [], rows: new Map() };
            blocks.push(current);
        } else {
            if (!current) return fail();
            if (key === 'char') current.chars.push(value);
            else if (key === 'char_uc') current.ucs.push(value);
            else if (metaFields.has(key)) {
                const row = /^(\d+)\s*\|\s*(.*)$/.exec(value);
                if (!row) return fail();
                const index = Number(row[1]), data = current.rows.get(index) || {};
                if (Object.hasOwn(data, key)) return fail();
                data[key] = row[2]; current.rows.set(index, data);
            } else {
                if (Object.hasOwn(current, key)) return fail();
                current[key] = value;
            }
        }
        last = key;
    }
    if (!blocks.length) return fail();
    const captions = [];

    for (const block of blocks) {
        if (block.prompt_mode !== 'dna_template') return fail('PROMPT_MODE_CONFLICT');
        if (block.outfit_mode !== undefined && block.outfit_mode !== 'template') return fail('OUTFIT_TEMPLATE_INVALID');
        if (block.chars.length > 16 || block.ucs.length !== block.chars.length || block.rows.size !== block.chars.length) return fail();
        const positive = [], negative = [], bindings = [], characters = [], candidates = [];
        for (let index = 0; index < block.chars.length; index += 1) {
            const raw = block.chars[index], row = block.rows.get(index);
            if (!row) return fail();
            const coord = /^([0-9]*\.?[0-9]+)\s*,\s*([0-9]*\.?[0-9]+)\s*\|\s*([\s\S]*)$/.exec(raw);
            if (!coord && raw.includes('|')) return fail();
            const x = coord ? Number(coord[1]) : 0.5, y = coord ? Number(coord[2]) : 0.5;
            if (![x, y].every((v) => Number.isFinite(v) && v >= 0 && v <= 1)) return fail();
            positive.push({ char_caption: coord ? coord[3] : raw, centers: [{ x, y }] });
            negative.push({ char_caption: block.ucs[index] });
            if (['generic', 'object'].includes(row.meta_kind)) {
                if (Object.keys(row).some((key) => key !== 'meta_kind')) return fail();
                bindings.push({ kind: row.meta_kind, captionIndex: index });
                continue;
            }
            if (!['named', 'reference'].includes(row.meta_kind)
                || !['meta_key', 'meta_token', 'meta_frame', 'meta_outfit_name', 'meta_outfit_description']
                    .every((key) => Object.hasOwn(row, key))) return fail();
            if (row.meta_kind === 'reference' && (row.meta_outfit_name !== ''
                || row.meta_outfit_description !== '')) return fail('OUTFIT_TEMPLATE_INVALID');
            bindings.push({ kind: row.meta_kind, characterKey: row.meta_key, captionIndex: index,
                token: row.meta_token, framing: row.meta_frame });
            const character = { characterKey: row.meta_key, captionIndex: index,
                identityAnchor: row.meta_identity || '', signatureDetails: row.meta_signature || '',
                outfit: { name: row.meta_outfit_name, description: row.meta_outfit_description },
                centers: coord ? [{ x, y }] : [], positionExplicit: Boolean(coord) };
            if (row.meta_region !== undefined) {
                const parts = row.meta_region.split(',');
                if (parts.length !== 4 || parts.some((v) => !v.trim())) return fail();
                const [rx, ry, width, height] = parts.map(Number);
                character.region = { x: rx, y: ry, width, height };
            }
            if (row.meta_kind === 'named') characters.push(character);
            else if (row.meta_region !== undefined) return fail();
            const views = {};
            for (const frame of CHARACTER_DNA_VIEWS) {
                const subject = row[`meta_dna_${frame}`], uc = row[`meta_dna_uc_${frame}`];
                if (subject !== undefined || uc !== undefined) views[frame] = { subject, ...(uc !== undefined && { negative: uc }) };
            }
            if (Object.keys(views).length) candidates.push({ characterKey: row.meta_key, views });
        }

        const caption = { v4_prompt: side(block.scene || '', positive), v4_negative_prompt: side(block.scene_uc || '', negative) };
        if (!caption.v4_prompt.caption.base_caption.trim() && !positive.some((c) => c.char_caption.trim())) return fail();
        const meta = checkCharacterMeta({ version: 1, characters }, caption, characterContext.map((c) => c.characterKey));
        if (!meta.ok) return meta;
        const entry = { slotId: block.slotId, caption, characterMeta: meta.value,
            promptRecipe: { version: 1, mode: 'dna_template', caption, bindings,
                ...(block.outfit_mode !== undefined && { outfitMode: block.outfit_mode }) },
            ...(candidates.length && { dnaCandidates: { version: 1, characters: candidates } }),
            ...(block.analysis !== undefined && { analysis: block.analysis }) };
        if (block.at !== undefined) {
            if (task.value.purpose !== 'cg' || !/^\d+$/.test(block.at)
                || !Number.isSafeInteger(Number(block.at)) || Number(block.at) < 1) return fail();
            entry.at = Number(block.at);
        }
        if (block.size !== undefined) {
            const size = /^(\d+)x(\d+)$/.exec(block.size);
            if (!size || !size.slice(1).every((v) => Number(v) >= 64 && Number(v) <= 4096 && Number(v) % 64 === 0)) return fail();
            entry.width = Number(size[1]); entry.height = Number(size[2]);
        }
        const checked = checkPromptOutput(entry, task.value, characterContext);
        if (!checked.ok) return checked;
        Object.assign(entry, checked.value);
        captions.push(entry);
    }
    return { ok: true, captions };
}
