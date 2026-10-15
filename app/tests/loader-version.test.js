import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../../loader/igs-loader.js', import.meta.url), 'utf8');
const version = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
const ref = `test-v${version}`;
const fixedContent = JSON.parse(fs.readFileSync(new URL(`../../loader/沉浸式Galgame系统 ${ref}.json`, import.meta.url), 'utf8')).content;
const base = `https://cdn.jsdelivr.net/gh/Anyno001/Immersive-Galgame-System-AnyNo001@${ref}`;
const instanceKey = '__IGS_AUTO_UPDATE_LOADER__';
const settle = async () => { for (let i = 0; i < 6; i++) await new Promise(resolve => setImmediate(resolve)); };

function harness({ oldVersion, oldRef, shutdown, servedVersion = version, probeStatus = 200, scriptError = false, auto = false } = {}) {
    const nodes = new Map(), scripts = [], requests = [], alerts = [], logs = [], timers = [];
    let stopped = 0, ensured = 0;
    const root = {
        setTimeout: (callback, ms) => { timers.push({ callback, ms }); return timers.length; },
        addEventListener() {}, removeEventListener() {},
        alert: message => alerts.push(message),
        eventOn: () => ({}), getButtonEvent: name => name,
        localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
        fetch: async (url, options) => {
            requests.push({ url, options });
            return { ok: probeStatus === 200, status: probeStatus, json: async () => ({ commit: { sha: 'b'.repeat(40) } }) };
        },
    };
    function api(apiVersion) {
        return { version: apiVersion, openSettings: () => ({}), openLatestAvailable: () => ({}),
            ensureMagicWandEntry: () => { ensured++; return { ok: true }; },
            async shutdown() { stopped++; if (shutdown) return shutdown(); return { ok: true }; } };
    }
    const doc = {
        querySelector: selector => selector.startsWith('#') ? nodes.get(selector.slice(1)) || null : null,
        querySelectorAll: () => [],
        createElement: tag => ({ tagName: tag, remove() { if (nodes.get(this.id) === this) nodes.delete(this.id); } }),
        head: { appendChild(node) {
            nodes.set(node.id, node);
            if (node.tagName !== 'script') return;
            scripts.push(node.src);
            queueMicrotask(() => {
                if (scriptError) { node.onerror?.(); return; }
                root.IGS = root.ImmersiveGalgameSystem = api(servedVersion);
                node.onload?.();
            });
        } },
    };
    root.document = doc; root.parent = root; root.top = root;
    if (oldVersion) root.IGS = root.ImmersiveGalgameSystem = api(oldVersion);
    if (oldRef) root[instanceKey] = { repository: 'Anyno001/Immersive-Galgame-System-AnyNo001', activeRef: oldRef,
        activeBase: `https://cdn.jsdelivr.net/gh/Anyno001/Immersive-Galgame-System-AnyNo001@${oldRef}` };
    const quiet = { info: (...args) => logs.push(args), warn: (...args) => logs.push(args), error: (...args) => logs.push(args) };
    const context = vm.createContext({ window: root, document: doc, console: quiet, Promise, Date });
    const content = auto ? source : fixedContent;
    return { root, nodes, scripts, requests, alerts, logs, run: () => vm.runInContext(content, context), stopped: () => stopped, ensured: () => ensured };
}

test('gate:loader:final-fixed-import-file-matches-source-with-only-its-tag-injected', () => {
    assert.equal(fixedContent, source.replace("const PINNED_REF = '';", `const PINNED_REF = ${JSON.stringify(ref)};`));
});

test('gate:loader:pinned-version-replaces-a-fully-working-older-runtime', async () => {
    const f = harness({ oldVersion: '0.36.59' });
    f.run(); await settle();
    assert.equal(f.stopped(), 1);
    assert.equal(f.root.IGS.version, version);
    assert.equal(f.scripts.length, 1);
    assert.equal(f.root[instanceKey].activeRef, ref);
    assert.ok(f.scripts.every(url => url.startsWith(`${base}/`)));
    assert.deepEqual(f.alerts, []);
});

test('gate:loader:matching-version-with-unknown-source-must-reload-the-tag', async () => {
    const f = harness({ oldVersion: version });
    f.run(); await settle();
    assert.equal(f.stopped(), 1); assert.equal(f.scripts.length, 1);
});

test('gate:loader:matching-version-from-main-cannot-substitute-for-a-fixed-tag', async () => {
    const f = harness({ oldVersion: version, oldRef: 'main' });
    f.run(); await settle();
    assert.equal(f.stopped(), 1); assert.equal(f.root[instanceKey].activeRef, ref);
});

test('gate:loader:only-the-same-tag-base-and-version-reuse-the-instance', async () => {
    const f = harness({ oldVersion: version, oldRef: ref });
    f.run(); await settle();
    assert.equal(f.stopped(), 0); assert.equal(f.scripts.length, 0);
    assert.equal(f.requests.length, 0); assert.equal(f.ensured(), 1);
    assert.equal(f.root[instanceKey].reused, true);
    assert.equal(f.root[instanceKey].activeRef, ref);
});

test('gate:loader:repeated-fixed-enable-reuses-the-successfully-loaded-tag', async () => {
    const f = harness();
    f.run(); await settle(); f.run(); await settle();
    assert.equal(f.scripts.length, 1); assert.equal(f.stopped(), 0);
    assert.equal(f.root[instanceKey].reused, true);
});

test('gate:loader:waits-for-the-old-media-owner-to-shut-down', async () => {
    let release;
    const f = harness({ oldVersion: '0.36.59', shutdown: () => new Promise(resolve => { release = resolve; }) });
    f.run(); await settle();
    assert.equal(f.stopped(), 1); assert.equal(f.scripts.length, 0); assert.equal(f.requests.length, 0);
    release({ ok: true }); await settle();
    assert.equal(f.root.IGS.version, version); assert.equal(f.scripts.length, 1);
});

test('gate:loader:failed-shutdown-stops-replacement', async () => {
    const f = harness({ oldVersion: '0.36.59', shutdown: async () => ({ ok: false, error: 'close-failed' }) });
    f.run(); await settle();
    assert.equal(f.scripts.length, 0); assert.equal(f.root.IGS.version, '0.36.59');
    assert.equal(f.alerts.length, 1); assert.match(f.alerts[0], /close-failed/);
});

test('gate:loader:unavailable-fixed-tag-fails-without-requesting-main', async () => {
    const f = harness({ probeStatus: 404 });
    f.run(); await settle();
    assert.equal(f.scripts.length, 0); assert.equal(f.alerts.length, 1);
    assert.ok(f.requests.length > 0);
    assert.ok(f.requests.every(request => request.url.startsWith(`${base}/`)));
    assert.equal(f.root.IGS, undefined);
});

test('gate:loader:fixed-module-startup-failure-cannot-fall-back-to-main', async () => {
    const f = harness({ scriptError: true });
    f.run(); await settle();
    assert.equal(f.scripts.length, 1); assert.equal(f.alerts.length, 1);
    assert.ok(f.requests.every(request => request.url.startsWith(`${base}/`)));
    assert.equal(f.root.IGS, undefined);
});

test('gate:loader:wrong-runtime-version-is-rejected-and-shut-down', async () => {
    const f = harness({ servedVersion: '0.36.59' });
    f.run(); await settle();
    assert.equal(f.scripts.length, 1); assert.equal(f.stopped(), 1);
    assert.equal(f.root.IGS, undefined); assert.equal(f.root.ImmersiveGalgameSystem, undefined);
    assert.equal(f.nodes.has('igs-auto-loader-css'), false);
    assert.equal(f.alerts.length, 1); assert.match(f.alerts[0], /实际 0\.36\.59/);
    assert.ok(f.alerts[0].includes(`要求 ${version}`));
});

test('gate:loader:fixed-tag-ignores-leftover-global-ref-and-base-overrides', async () => {
    const f = harness();
    f.root.IGS_LOADER_REF = 'v0.36.59';
    f.root.IGS_LOADER_BASE = 'https://example.test/old';
    f.root.IGS_LOADER_CONFIG = { ref: 'v0.36.59', base: 'https://example.test/config' };
    f.run(); await settle();
    assert.equal(f.root.IGS.version, version);
    assert.ok(f.requests.every(request => request.url.startsWith(`${base}/`)));
    assert.ok(f.scripts.every(url => url.startsWith(`${base}/`)));
    assert.equal(f.root.IGS_LOADER_REF, 'v0.36.59', '固定 tag 不写全局 ref，避免污染其他 loader');
});

test('gate:loader:auto-update-replaces-a-runtime-from-a-different-commit', async () => {
    const f = harness({ auto: true, oldVersion: '0.36.59', oldRef: 'a'.repeat(40) });
    f.run(); await settle();
    assert.equal(f.stopped(), 1); assert.equal(f.root.IGS.version, version);
    assert.equal(f.root[instanceKey].activeRef, 'b'.repeat(40));
    assert.equal(f.scripts.length, 1);
});
