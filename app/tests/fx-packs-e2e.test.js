import test from 'node:test';
import assert from 'node:assert/strict';
import { FX_PACK_KINDS, packOfKind, packFxOf, parsePackFxBody } from '../src/scene/fx-packs.js';

const MIN_FIELDS = {
    mark: ['', '潮红', '脸颊'],
    crowd: ['鼓掌'],
    test: ['阳性'],
    vote: ['甲:3;乙:2'],
    rank: ['甲:30;乙:20'],
    relmap: ['甲>乙'],
    pair: ['甲+乙'],
    hmselect: ['留牌子', '甲'],
    hmprobe: ['银针', '无毒'],
    hmpunish: ['冷宫', '甲'],
    hmtray: ['白绫', '甲'],
    phase: ['发情期', '3/7', '甲'],
    traits: ['甲', '耳,尾'],
    stats: ['甲', 'STR:60;CON:55;DEX:70'],
    race: ['冲线', '甲', '10'],
    levelup: ['2'],
    quest: ['委托'],
    route: ['甲地', '乙地'],
    debut: ['甲:1;乙:2', '出道'],
};

const GENERIC = [[], ['甲'], ['甲', '乙'], ['1'], ['1', '2'], ['甲', '乙', '50']];

test('every registered pack kind parses through parsePackFxBody and packFxOf', () => {
    const missing = [];
    for (const kind of FX_PACK_KINDS) {
        const candidates = MIN_FIELDS[kind] ? [MIN_FIELDS[kind]] : GENERIC;
        let body = null;
        for (const fields of candidates) {
            body = parsePackFxBody(kind, fields);
            if (body) break;
        }
        if (!body) {
            missing.push(kind);
            continue;
        }
        const item = packFxOf(body);
        if (!item || item.type !== kind) missing.push(`${kind}(of)`);
    }
    assert.deepEqual(missing, []);
});

test('every registered pack kind has a builder', () => {
    const noBuilder = [];
    for (const kind of FX_PACK_KINDS) {
        const owner = packOfKind(kind);
        if (!owner || typeof owner.builders[kind] !== 'function') noBuilder.push(kind);
    }
    assert.deepEqual(noBuilder, []);
});
