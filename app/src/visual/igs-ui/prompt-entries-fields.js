import { normalizePromptEntries, parsePromptKeywords, PROMPT_ENTRY_DEPTH_MAX, PROMPT_ENTRY_KEYS, PROMPT_ENTRY_LABELS, PROMPT_POSITION_LABELS } from '../../scene/prompt-entries.js';
import { defaultPromptKeywords, describePromptTrigger } from '../../scene/prompt-triggers.js';
import { esc } from './reader-value-utils.js';
import { FX_PROMPT_KEYS, normalizeFxPromptsSettings } from './fx-settings.js';
import { fxBuiltinPromptTexts, FX_PROMPT_LABELS } from './fx-settings-fields.js';
import { checkbox, field, numberInput, segmentedInput, selectInput, textareaInput } from './settings-fields.js';

// 写法规则页下半：演出写法按世界书条目排版。每条 启用 / 常驻 / 关键词 / 注入位置 / 深度 / 正文，一行一条，同一时间只展开一条。
const P = 'bridge.sceneAssets.promptEntries';
const FX = 'readerSettings.fxPrompts';
const FIXED_KEYS = FX_PROMPT_KEYS.filter((key) => !PROMPT_ENTRY_KEYS.includes(key));
export const chars = (text) => Array.from(String(text || '')).length;

// 打字时就地改字数节点（输入不重绘）。清空表示恢复内置写法，实际发送的是内置那份，所以显示内置字数。
export function updateCharCounts(root, path, value) {
    if (!root || !path) return;
    for (const node of root.querySelectorAll('[data-char-count-for]')) {
        if (node.getAttribute('data-char-count-for') !== path) continue;
        const fallback = Number(node.getAttribute('data-char-fallback')) || 0;
        const text = String(value || '');
        node.textContent = String(text ? chars(text) : fallback);
    }
}

function globalLabel(sceneAssets) {
    return sceneAssets && sceneAssets.promptPlacement === 'depth0' ? PROMPT_POSITION_LABELS.depth0 : PROMPT_POSITION_LABELS.system;
}

function positionLabel(entry, fallback) {
    if (!entry.position) return fallback;
    return entry.position === 'depth' ? `${PROMPT_POSITION_LABELS.depth} @D${entry.depth}` : PROMPT_POSITION_LABELS[entry.position];
}

function triggerSummary(key, entry) {
    if (entry.mode === 'always') return '常驻';
    const words = parsePromptKeywords(entry.keys || defaultPromptKeywords(key));
    return words.length ? `关键词 ${words.slice(0, 2).join('、')}${words.length > 2 ? '…' : ''}` : '关键词';
}

function lastLine(item) {
    if (!item) return '';
    const state = item.reason === 'off' ? '' : item.active ? '已发送' : '未发送';
    const size = item.active && item.chars ? ` · ${item.chars}字` : '';
    return `上次：${[state, describePromptTrigger(item)].filter(Boolean).join(' · ')}${size}`;
}

const flag = (key, which, on, label, disabled = false) => `<button type="button" class="igs-switch${on ? ' is-on' : ''}" data-action="prompt-entry-flag:${esc(key)}:${which}" aria-pressed="${on ? 'true' : 'false'}"${disabled ? ' disabled' : ''}><i></i><span>${esc(label)}</span></button>`;

function rowShell(key, name, hint, open, body) {
    return `<div class="igs-perf-item igs-prompt-entry" data-prompt-entry="${esc(key)}">`
        + `<button type="button" class="igs-prompt-entry-row${open ? ' is-open' : ''}" data-action="ui-toggle-open:prompt-entry-${esc(key)}" aria-expanded="${open ? 'true' : 'false'}">`
        + `<span class="igs-prompt-entry-name">${esc(name)}</span><small class="igs-perf-item-hint">${esc(hint)}</small><i class="igs-prompt-entry-chev"></i></button>`
        + (open ? `<div class="igs-perf-item-body">${body}</div>` : '') + '</div>';
}

function bodyField(key, label, text, own, builtinText = '') {
    const path = own ? `${P}.${key}.text` : `${FX}.${key}`;
    const note = own ? '' : `${label}的写法；改动即覆盖，清空恢复内置。`;
    const count = `<span data-char-count-for="${esc(path)}" data-char-fallback="${chars(builtinText)}">${chars(text)}</span>`;
    return `<label class="igs-settings-field"><span>正文（${count}字）</span>${textareaInput(path, text, '清空恢复默认')}${note ? `<em>${esc(note)}</em>` : ''}</label>`;
}

function entryRow(key, entry, ctx) {
    const { builtin, fx, report, open, fallbackPos } = ctx;
    const ownText = !FX_PROMPT_KEYS.includes(key);
    const text = (ownText ? entry.text : fx[key]) || builtin[key] || '';
    const available = Boolean(text);
    // 功能没开、又没改过设置的条目不列出，免得列表里全是用不到的行。
    if (!available && entry.mode === 'auto' && !entry.keys && !entry.position && !entry.text) return '';
    const hint = entry.mode === 'off' ? '已关闭'
        : !available ? '功能未开启'
            : `${triggerSummary(key, entry)} · ${positionLabel(entry, fallbackPos)}`;
    let body = '';
    if (open) {
        const off = entry.mode === 'off';
        const last = lastLine(report && report[key]);
        const posItems = [['', `跟随全局（${fallbackPos}）`], ['system', PROMPT_POSITION_LABELS.system], ['depth0', PROMPT_POSITION_LABELS.depth0], ['depth', PROMPT_POSITION_LABELS.depth]];
        body = `<div class="igs-prompt-entry-flags">${flag(key, 'enabled', !off, '启用')}${flag(key, 'always', entry.mode === 'always', '常驻', off)}</div>`
            + (entry.mode === 'auto' ? field(`${P}.${key}.keys`, '触发关键词', textareaInput(`${P}.${key}.keys`, entry.keys || defaultPromptKeywords(key), '清空恢复默认'), '用、分隔；/…/ 写正则') : '')
            + field(`${P}.${key}.position`, '注入位置', selectInput(`${P}.${key}.position`, entry.position, posItems))
            + (entry.position === 'depth' ? field(`${P}.${key}.depth`, '插入深度', numberInput(`${P}.${key}.depth`, entry.depth, 0, PROMPT_ENTRY_DEPTH_MAX), '倒数第几条消息处，0 为最末') : '')
            + bodyField(key, PROMPT_ENTRY_LABELS[key], text, ownText, builtin[key])
            + (last ? `<div class="igs-source-filter-note">${esc(last)}</div>` : '')
            + `<div class="igs-settings-row"><button type="button" class="igs-settings-action" data-action="prompt-entry-reset:${esc(key)}">恢复默认</button></div>`;
    }
    return rowShell(key, PROMPT_ENTRY_LABELS[key], hint, open, body);
}

function fixedRow(key, ctx) {
    const { builtin, fx, open } = ctx;
    const text = fx[key] || builtin[key] || '';
    if (!text) return '';
    return rowShell(key, FX_PROMPT_LABELS[key], '随功能开关发送', open, open ? bodyField(key, FX_PROMPT_LABELS[key], text, false, builtin[key]) : '');
}

// reader 为当前设置里的 readerSettings（取内置写法与总开关）；report 为最近一次注入的情况；isOpen(key) 判断某行是否展开。
export function renderPromptEntryFields(sceneAssets, { reader = {}, report = null, isOpen = () => false } = {}) {
    const entries = normalizePromptEntries(sceneAssets && sceneAssets.promptEntries);
    const fx = normalizeFxPromptsSettings(reader && reader.fxPrompts);
    const blocks = report && report.blocks ? report.blocks : null;
    const builtin = fxBuiltinPromptTexts(reader || {});
    const ctx = { builtin, fx, report: blocks, fallbackPos: globalLabel(sceneAssets) };
    const open = (key) => isOpen(`prompt-entry-${key}`);
    const rows = PROMPT_ENTRY_KEYS.map((key) => entryRow(key, entries[key], { ...ctx, open: open(key) })).join('');
    const fixed = FIXED_KEYS.map((key) => fixedRow(key, { ...ctx, open: open(key) })).join('');
    // 两个开关并排一行，写法（详细 / 精简）放在开关下面，不把两个开关隔开。
    const head = `<div class="igs-settings-row igs-switch-stack">${checkbox(`${FX}.inject`, fx.inject, '把演出写法发给AI')}${checkbox(`${FX}.resident`, fx.resident, '全量常驻（更耗费用，默认关）')}</div>`
        + field(`${FX}.style`, '写法', segmentedInput(`${FX}.style`, fx.style, [['detailed', '详细'], ['compact', '精简']], '写法'))
        + '<div class="igs-settings-row"><button type="button" class="igs-settings-action" data-action="fx-prompts-copy-all">复制全部</button></div>';
    return '<div class="igs-source-filter-title">演出写法</div>'
        + '<div class="igs-source-filter-note">每条演出一行：可设常驻或关键词、注入位置和正文。不改就和默认一样；触发情况也会写进「本页诊断」。</div>'
        + head + rows
        + (fixed ? `<div class="igs-settings-subhead">固定写法</div>${fixed}` : '');
}
