import assert from 'node:assert/strict';
import test from 'node:test';
import { ITEM_FX_STYLE_TEXT } from '../src/visual/igs-ui/fx-item.js';
import { getDialogSkinStyleText } from '../src/visual/igs-ui/dialog-skin-style.js';

const WHITE = /^(?:#fff(?:fff)?|white|rgba?\(255,\s*255,\s*255(?:,\s*[\d.]+)?\))$/i;

function ruleBody(css, selector) {
    const line = css.split('\n').find((text) => text.startsWith(`${selector}{`));
    assert.ok(line, `缺规则 ${selector}`);
    return line.slice(selector.length + 1, line.lastIndexOf('}'));
}

function colorOf(body) {
    const match = /(?:^|;)color:([^;]+)(?:;|$)/.exec(body);
    assert.ok(match, `没有显式前景色：${body.slice(0, 80)}`);
    return match[1].trim();
}

test('青绿山水的物品中央弹窗：标题与图标前景不是白色', () => {
    const skin = 'qinglv-shanshui';
    const css = getDialogSkinStyleText(skin);
    const scope = `#igs-overlay[data-igs-dialog-skin="${skin}"]`;
    assert.doesNotMatch(colorOf(ruleBody(css, `${scope} .igs-fx-item-showcase-plate`)), WHITE, '弹窗标题不应为白色');
    assert.doesNotMatch(colorOf(ruleBody(css, `${scope} .igs-fx-item-icon[data-igs-item-placeholder]`)), WHITE, '弹窗图标不应为白色');
});

test('古代弹窗用深墨与朱砂前景；世界观浅纸面的占位图标跟随面板色', () => {
    assert.match(ITEM_FX_STYLE_TEXT, /\.igs-fx-item-showcase\[data-igs-era="ancient"\]:not\(#igs-era-x\) \.igs-fx-item-showcase-name\{color:#2b1d12/);
    assert.match(ITEM_FX_STYLE_TEXT, /\.igs-fx-item-showcase\[data-igs-era="ancient"\][^{]*\.igs-fx-item-icon\[data-igs-item-placeholder\]\{[^}]*color:#7a2a1a/);
    assert.match(ITEM_FX_STYLE_TEXT, /\.igs-fx-item-showcase\[data-igs-era\]:not\(\[data-igs-era="ancient"\]\):not\(#igs-era-x\) \.igs-fx-item-showcase-plate \.igs-fx-item-icon\[data-igs-item-placeholder\]\{color:inherit;\}/);
});
