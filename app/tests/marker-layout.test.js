import test from 'node:test';
import assert from 'node:assert/strict';
import { insertMarkersAtAnchors, insertMarkers, numberParagraphs, transplantMarkers } from '../src/generated-images/illustration/marker-placer.js';
import { buildIgsTextPayload } from '../src/scene/message-source.js';
import { normalizeImageMarkerLayout } from '../src/scene/image-marker-layout.js';

test('gate:marker-layout:dialogue-anchor-waits-for-complete-directive', () => {
    const dialogue = '[igs-char:白墨|温和|先把画挂起来。你觉得呢？]';
    const raw = `<content>\n${dialogue}\n</content>`;
    assert.equal(insertMarkersAtAnchors(raw, [{ slot: 19, anchorSentence: '先把画挂起来。' }]), `<content>\n${dialogue}\n[igs-img:19]\n</content>`);
});

test('gate:marker-layout:thought-fx-wide-and-multiline-brackets-are-never-split', () => {
    for (const unit of ['[igs-thought:白墨|平和|先把画挂起来。再想一想。]', '[igs-fx:letter|先把画挂起来。再想一想。]', '【igs-char：白墨｜平和｜先把画挂起来。再想一想。】', '[igs-char:白墨|平和|先把画挂起来。\n再想一想。]']) {
        const raw = `<content>\n${unit}\n</content>`;
        assert.equal(insertMarkersAtAnchors(raw, [{ slot: 1, anchorSentence: '先把画挂起来。' }]), `<content>\n${unit}\n[igs-img:1]\n</content>`);
    }
});

test('gate:marker-layout:html-card-and-fenced-block-stay-intact', () => {
    for (const unit of ['<htm1fenge>\n<div><p>先把画挂起来。</p></div>\n</htm1fenge>', '<信件>\n先把画挂起来。\n</信件>', '```html\n<div>先把画挂起来。</div>\n```']) {
        const raw = `<content>\n${unit}\n</content>`;
        assert.equal(insertMarkersAtAnchors(raw, [{ slot: 1, anchorSentence: '先把画挂起来。' }]), `<content>\n${unit}\n[igs-img:1]\n</content>`);
    }
});

test('gate:marker-layout:single-line-content-and-numbered-paragraph-use-standalone-marker', () => {
    const raw = '<content>[igs-scene:宫道|晚上|晴][igs-char:白墨|温和|先把画挂起来。]</content>';
    const expected = '<content>[igs-scene:宫道|晚上|晴][igs-char:白墨|温和|先把画挂起来。]\n[igs-img:19]\n</content>';
    assert.equal(insertMarkersAtAnchors(raw, [{ slot: 19, anchorSentence: '先把画挂起来。' }]), expected);
    assert.equal(insertMarkers(raw, numberParagraphs(raw).paragraphs, [{ slot: 19, at: 1 }]), expected);
});

test('gate:marker-layout:multiple-points-do-not-split-one-line-or-drop-slots', () => {
    const raw = '[igs-char:白墨|平和|先把画挂起来。再把灯点上。]';
    assert.equal(insertMarkersAtAnchors(raw, [{ slot: 4, anchorSentence: '先把画挂起来。' }, { slot: 3, anchorSentence: '再把灯点上。' }]), `${raw}\n[igs-img:4]\n[igs-img:3]`);
});

test('gate:marker-layout:transplant-cannot-insert-inside-new-dialogue-structure', () => {
    const before = '先把画挂起来。\n[igs-img:19]\n然后点灯。';
    const unit = '[igs-char:白墨|温和|先把画挂起来。你觉得呢？]';
    const target = `<content>\n${unit}\n然后点灯。\n</content>`;
    assert.equal(transplantMarkers(before, target).text, `<content>\n${unit}\n[igs-img:19]\n然后点灯。\n</content>`);
});

test('gate:marker-layout:legacy-native-marker-before-dialogue-close-does-not-create-a-second-page', () => {
    const raw = '<content>\n[igs-char:白墨|温和|先把画挂起来，你觉得呢？\n<IMG>\n19\n</IMG>\n]\n</content>';
    const result = buildIgsTextPayload({ text: raw }, { sceneAssets: { enabled: true, characters: { 白墨: { 默认: 'base.png' } } } });
    assert.equal(result.raw, raw, '读取兼容不得改写用户原消息');
    assert.deepEqual(result.textSegments, ['[白墨]：先把画挂起来，你觉得呢？']);
});

test('gate:marker-layout:normalization-is-idempotent-and-keeps-native-slot-identities', () => {
    const raw = '<content>\n[igs-char:白墨|温和|第一句。\n<IMG>\n19\n</IMG>\n第二句。]\n[igs-img:20]\n</content>';
    const expected = '<content>\n[igs-char:白墨|温和|第一句。第二句。]\n<IMG>19</IMG>\n[igs-img:20]\n</content>';
    assert.equal(normalizeImageMarkerLayout(raw), expected);
    assert.equal(normalizeImageMarkerLayout(expected), expected);
});

test('gate:marker-layout:crlf-and-unclosed-structures-do-not-get-corrupted', () => {
    const raw = '<content>\r\n[igs-char:白墨|平和|先把画挂起来。]\r\n</content>';
    assert.equal(insertMarkersAtAnchors(raw, [{ slot: 1, anchorSentence: '先把画挂起来。' }]), '<content>\r\n[igs-char:白墨|平和|先把画挂起来。]\r\n[igs-img:1]\r\n</content>');
    const unfinished = '<content>\n[igs-char:白墨|平和|先把画挂起来。\n</content>';
    assert.equal(insertMarkersAtAnchors(unfinished, [{ slot: 1, anchorSentence: '先把画挂起来。' }]), unfinished);
    const attribute = '<content>\n<img alt="先把画挂起来。\n更多文字" src="a.png">\n</content>';
    assert.equal(insertMarkersAtAnchors(attribute, [{ slot: 1, anchorSentence: '先把画挂起来。' }]), '<content>\n<img alt="先把画挂起来。\n更多文字" src="a.png">\n[igs-img:1]\n</content>');
});
