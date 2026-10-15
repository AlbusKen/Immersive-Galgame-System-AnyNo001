import test from 'node:test';
import assert from 'node:assert/strict';
import { SELECTED_CALLIGRAPHY_STYLE_TEXT } from '../src/visual/igs-ui/fx-selected-calligraphy-style.js';
import { FX_STYLE_TEXT } from '../src/visual/igs-ui/fx-style.js';

test('only the eight approved performances receive the licensed calligraphy font', () => {
    const css = SELECTED_CALLIGRAPHY_STYLE_TEXT.replace(/@font-face\{[^}]+\}/g, '');
    for (const cls of ['igs-dfx-biguan', 'igs-myth-mythroll', 'igs-myth-subdue', 'igs-myth-core', 'igs-myth-pact', 'igs-dfx-riverlamp.is-ancient', 'igs-dfx-wedding.is-cn', 'igs-dfx-countdown.is-ancient']) assert.ok(css.includes(cls), cls);
    for (const cls of ['igs-myth-flame', 'igs-dfx-redpacket', 'igs-dfx-wedding.is-west', 'igs-text', 'body', '.replay']) assert.ok(!css.includes(cls), cls);
    assert.ok(css.includes('"KaiTi","Noto Serif CJK SC","Noto Serif SC",serif'), 'missing glyphs use installed CJK/serif fallback instead of box substitution');
    assert.ok(FX_STYLE_TEXT.includes(SELECTED_CALLIGRAPHY_STYLE_TEXT.trim()), 'registered through existing runtime style entry');
    assert.ok(!SELECTED_CALLIGRAPHY_STYLE_TEXT.includes('data:font'), 'fonts stay outside executable bundle');
    assert.ok(SELECTED_CALLIGRAPHY_STYLE_TEXT.length < 8192, 'selector-only style stays under 8KiB');
});

import { JSDOM } from 'jsdom';
import { XIANXIA_BUILDERS } from '../src/visual/igs-ui/fx-daily-xianxia.js';
import { MYTH_BUILDERS } from '../src/visual/igs-ui/fx-myth.js';
import { FESTIVAL_BUILDERS } from '../src/visual/igs-ui/fx-festival-build.js';

test('approved font rules match actual renderer text in each of the eight samples', () => {
    const dom = new JSDOM('<div id="igs-overlay"><div id="igs-stage-motion"></div></div>');
    const root = dom.window.document.querySelector('#igs-overlay');
    const env = { doc: dom.window.document, root, reduced: true, hold: 1, ancient: true, worldview: 'ancient', layers: { motion: root }, state: { timers: new Set(), schedule: () => 0, clear() {} } };
    const cases = [
        [29, XIANXIA_BUILDERS.biguan, { text: '金丹初成' }],
        [62, MYTH_BUILDERS.mythroll, { names: ['沈清辞', '柳如烟'] }],
        [69, MYTH_BUILDERS.subdue, { mode: 'talisman' }],
        [71, MYTH_BUILDERS.core, { name: '千年妖丹' }],
        [72, MYTH_BUILDERS.pact, { a: '沈清辞', b: '柳如烟' }],
        [73, FESTIVAL_BUILDERS.riverlamp, { text: '愿岁岁平安' }],
        [74, FESTIVAL_BUILDERS.wedding, { style: 'cn', text: '执子之手' }],
        [75, FESTIVAL_BUILDERS.countdown, { count: '3', label: '辞旧迎新' }],
    ];
    const selectors = SELECTED_CALLIGRAPHY_STYLE_TEXT.trim().split('{')[0];
    for (const [id, build, item] of cases) {
        const result = build(item, env);
        root.replaceChildren(result.node);
        assert.ok(dom.window.document.querySelector(selectors), `sample ${id}: at least one real renderer text target must match`);
    }
    const modernWedding = FESTIVAL_BUILDERS.wedding({ style: 'west', text: 'Wedding' }, { ...env, ancient: false, worldview: 'modern' });
    root.replaceChildren(modernWedding.node);
    assert.equal(dom.window.document.querySelector(selectors), null, 'modern wedding remains unchanged');
    dom.window.close();
});
