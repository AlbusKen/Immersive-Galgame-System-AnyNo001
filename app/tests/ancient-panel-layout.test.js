import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM, VirtualConsole } from 'jsdom';
import { createIgsReaderHost } from '../src/visual/igs-ui/reader-host.js';
import { BEATS_BUILDERS } from '../src/visual/igs-ui/fx-beats-build.js';
import { PLACES_BUILDERS } from '../src/visual/igs-ui/fx-places-render.js';

test('long ancient panel content scrolls inside actual host without invoking page navigation', () => {
    const vc = new VirtualConsole();
    const errors = [];
    vc.on('jsdomError', (error) => errors.push(error.message));
    const dom = new JSDOM('<!doctype html><body></body>', { url: 'https://example.invalid', pretendToBeVisual: true, virtualConsole: vc });
    dom.window.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
    const doc = dom.window.document;
    const host = createIgsReaderHost({ global: dom.window, getUnifiedSettings: () => ({ bridge: { sceneAssets: { enabled: false, scenes: {}, characters: {} } }, readerSettings: { titleScreen: false } }) });
    try {
        const raw = '第一段。\n第二段。';
        const opened = host.openReader({ messageId: 4, message: { id: 4, text: raw }, raw }, { mode: 'pc' });
        assert.equal(opened.ok, true);
        const actions = [];
        opened.controller.invokeAction = (action) => actions.push(action);
        const root = doc.getElementById('igs-overlay');
        const env = { root, doc, ancient: true, worldview: 'ancient', reduced: true, hold: 1 };
        const built = BEATS_BUILDERS.panel({ kind: 'system', title: '<script>标题</script>'.repeat(20), rows: ['修为：+200', '说明：' + '长文'.repeat(250)] }, env);
        root.append(built.node);
        const region = built.node.querySelector('.igs-panel-rows');
        assert.ok(region.classList.contains('igs-ancient-panel-scroll'));
        assert.equal(built.node.querySelector('script'), null);
        assert.equal(built.node.querySelectorAll('.igs-panel-row.is-long-content').length, 1);
        assert.equal(built.node.querySelector('.igs-panel-row').classList.contains('is-long-content'), false);
        Object.defineProperty(region, 'clientHeight', { value: 120 });
        Object.defineProperty(region, 'scrollHeight', { value: 900 });
        region.focus();
        const key = (target, value) => target.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: value, code: value, bubbles: true, cancelable: true }));
        key(region, 'ArrowDown'); assert.equal(region.scrollTop, 90);
        key(region, 'End'); assert.equal(region.scrollTop, 900);
        key(region, 'Home'); assert.equal(region.scrollTop, 0);
        key(region, 'ArrowRight'); assert.equal(region.scrollTop, 90);
        assert.deepEqual(actions, []);
        key(doc.body, 'ArrowRight'); assert.deepEqual(actions, ['next']);
        key(region, 'Escape'); assert.equal(host.getState().activeReader, null);
        assert.deepEqual(errors, []);
    } finally { host.destroy(); dom.window.close(); }
});

test('only ancient counts, quest and system cards gain bounded text navigation', () => {
    const dom = new JSDOM('<div id="igs-overlay"></div>');
    const doc = dom.window.document, root = doc.getElementById('igs-overlay');
    for (const ancient of [false, true]) {
        const env = { root, doc, ancient, reduced: true, hold: 1, worldview: ancient ? 'ancient' : 'modern' };
        for (const [builder, data] of [[BEATS_BUILDERS.count, { label: '长积分名'.repeat(30), from: 150, to: 0, unit: '分' }], [PLACES_BUILDERS.quest, { state: 'take', title: '长任务'.repeat(40), reward: '五百灵石' }]]) {
            const built = builder(data, env);
            assert.equal(Boolean(built.node.querySelector('.igs-ancient-panel-scroll')), ancient);
            assert.equal(built.life, 3600);
        }
    }
    dom.window.close();
});
