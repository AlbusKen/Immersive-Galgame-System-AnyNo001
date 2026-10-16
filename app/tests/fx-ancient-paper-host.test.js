import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM, VirtualConsole } from 'jsdom';
import { createIgsReaderHost } from '../src/visual/igs-ui/reader-host.js';
import { makeAncientPaper } from '../src/visual/igs-ui/fx-ancient-paper.js';

test('paper navigation survives the actual reader document capture handler without flipping pages', () => {
    const errors = [];
    const virtualConsole = new VirtualConsole();
    virtualConsole.on('jsdomError', (error) => errors.push(error.message));
    const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', {
        url: 'https://example.invalid', pretendToBeVisual: true, virtualConsole,
    });
    dom.window.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
    const doc = dom.window.document;
    const host = createIgsReaderHost({
        global: dom.window,
        getUnifiedSettings: () => ({ bridge: { sceneAssets: { enabled: false, scenes: {}, characters: {} } }, readerSettings: { titleScreen: false } }),
    });
    try {
        const raw = '第一段。\n第二段。';
        const opened = host.openReader({ messageId: 4, message: { id: 4, text: raw }, raw }, { mode: 'pc' });
        assert.equal(opened.ok, true);
        const actions = [];
        opened.controller.invokeAction = (action) => { actions.push(action); };
        const node = makeAncientPaper({ text: '长信'.repeat(80) }, { doc, ancient: true, reduced: true });
        doc.getElementById('igs-overlay').append(node);
        const scroll = node.querySelector('.igs-dfx-document-scroll');
        Object.defineProperty(scroll, 'clientWidth', { value: 200 });
        Object.defineProperty(scroll, 'scrollWidth', { value: 900 });
        scroll.focus();
        const key = (target, value) => target.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: value, code: value, bubbles: true, cancelable: true }));
        key(scroll, 'ArrowLeft');
        assert.equal(scroll.scrollLeft, -160);
        key(scroll, 'ArrowRight');
        assert.equal(scroll.scrollLeft, 0);
        key(scroll, 'End');
        assert.equal(scroll.scrollLeft, -900);
        key(scroll, 'Home');
        assert.equal(scroll.scrollLeft, 0);
        assert.deepEqual(actions, [], 'capture handler must not execute any reader shortcut inside paper');
        assert.equal(host.getState().activeReader.snapshot.content.currentIndex, 0);
        let outerClicks = 0;
        node.parentNode.addEventListener('click', () => { outerClicks++; });
        for (const type of ['pointerdown', 'pointermove', 'pointerup', 'click']) {
            const input = new dom.window.MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: type === 'pointerdown' ? 20 : 150 });
            Object.defineProperty(input, 'pointerId', { value: 1 });
            Object.defineProperty(input, 'pointerType', { value: 'mouse' });
            scroll.dispatchEvent(input);
        }
        assert.equal(outerClicks, 0, 'click after a drag is consumed by the scroll surface');
        assert.deepEqual(actions, []);
        key(doc.body, 'ArrowRight');
        assert.deepEqual(actions, ['next'], 'the real capture shortcut handler remains active outside paper');
        key(scroll, 'Escape');
        assert.equal(host.getState().activeReader, null, 'Escape retains the reader close action');
        assert.deepEqual(errors, []);
    } finally {
        host.destroy();
        dom.window.close();
    }
});
