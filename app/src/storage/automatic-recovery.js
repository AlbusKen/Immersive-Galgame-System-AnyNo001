// 原操作持有输入和已完成步骤；再次执行必须有修复进展或真实的环境变更。
const recoverySignals = new WeakMap();
const recoverySignalFor = global => {
    if (!recoverySignals.has(global)) recoverySignals.set(global, { revision: 0, listeners: new Set() });
    return recoverySignals.get(global);
};
export function recoveryCancelled(value) {
    return value?.cancelled === true || /^(?:cancelled|canceled|user-cancelled|dna-cancelled|abort-by-user|request-stale|stale-target|stale-chat|stale-config)$/.test(value?.reason || '');
}

export function wakeRecoveringOperations(global = globalThis) {
    const state = recoverySignalFor(global);
    state.revision++;
    for (const listener of [...state.listeners]) listener();
    if (typeof global.dispatchEvent !== 'function') return;
    const EventCtor = global.Event || globalThis.Event;
    if (EventCtor) global.dispatchEvent(new EventCtor('igs:recovery-wake'));
}

export function waitForRecoveryChange({ signal, global = globalThis, revision } = {}) {
    const state = recoverySignalFor(global);
    return new Promise(resolve => {
        let done = false;
        const finish = () => {
            if (done) return;
            done = true;
            state.listeners.delete(finish);
            signal?.removeEventListener?.('abort', finish);
            for (const name of ['online', 'storage', 'igs:recovery-wake']) global.removeEventListener?.(name, finish);
            resolve();
        };
        if (signal?.aborted || (revision !== undefined && state.revision !== revision)) { finish(); return; }
        state.listeners.add(finish);
        signal?.addEventListener?.('abort', finish, { once: true });
        for (const name of ['online', 'storage', 'igs:recovery-wake']) global.addEventListener?.(name, finish, { once: true });
    });
}

export function linkRecoverySignals(inputs) {
    const signals = [...new Set(inputs.filter(Boolean))];
    if (signals.length < 2) return { signal: signals[0], release() {} };
    if (typeof AbortSignal.any === 'function') {
        try { return { signal: AbortSignal.any(signals), release() {} }; } catch { /* 宿主的兼容信号走事件接口。 */ }
    }
    const controller = new AbortController();
    const release = () => signals.forEach(signal => signal.removeEventListener?.('abort', abort));
    const abort = () => { controller.abort(); release(); };
    if (signals.some(signal => signal.aborted)) abort();
    else signals.forEach(signal => signal.addEventListener?.('abort', abort, { once: true }));
    return { signal: controller.signal, release };
}

export function createOperationCheckpoint() {
    const completed = new Map(), pending = new Map();
    return {
        async step(key, execute) {
            if (completed.has(key)) return completed.get(key);
            if (pending.has(key)) return pending.get(key);
            const job = Promise.resolve().then(execute).then(value => {
                if (value !== false && value?.ok !== false && !recoveryCancelled(value)) completed.set(key, value);
                return value;
            }).finally(() => pending.delete(key));
            pending.set(key, job);
            return job;
        },
        forget(key) { completed.delete(key); },
        clear() { completed.clear(); },
    };
}

export function waitForRecovery(ms, { signal, global = globalThis } = {}) {
    return new Promise(resolve => {
        if (signal?.aborted) { resolve(); return; }
        const state = recoverySignalFor(global);
        let timer;
        const done = () => {
            (global.clearTimeout || clearTimeout)(timer);
            signal?.removeEventListener?.('abort', done);
            state.listeners.delete(done);
            global.removeEventListener?.('online', done);
            global.removeEventListener?.('igs:recovery-wake', done);
            resolve();
        };
        timer = (global.setTimeout || setTimeout)(done, ms);
        state.listeners.add(done);
        signal?.addEventListener?.('abort', done, { once: true });
        global.addEventListener?.('online', done, { once: true });
        global.addEventListener?.('igs:recovery-wake', done, { once: true });
    });
}

async function recoveryStep(execute, signal) {
    if (signal?.aborted) return { ok: false, cancelled: true, reason: 'cancelled' };
    const pending = Promise.resolve(execute());
    if (typeof signal?.addEventListener !== 'function') return pending;
    let abort;
    try { return await Promise.race([pending, new Promise(resolve => {
        abort = () => resolve({ ok: false, cancelled: true, reason: 'cancelled' });
        signal.addEventListener('abort', abort, { once: true });
        if (signal.aborted) abort();
    })]); } finally { signal.removeEventListener('abort', abort); }
}

export async function recoverOperation(execute, { signal, isActive = () => true,
    shouldRecover = () => true, repair, onRecover, wait = waitForRecovery,
    retryUnchanged = true, canResume = () => true, observe,
    initialDelayMs = 100, maxDelayMs = 30000, global = globalThis } = {}) {
    let attempt = 0, retriedUnchanged = false;
    while (!signal?.aborted && isActive()) {
        const revision = recoverySignalFor(global).revision;
        let result, cause;
        try {
            result = await recoveryStep(execute, signal);
        } catch (error) { cause = error; result = error?.result || { ok: false, reason: error?.code || error?.message || 'operation-pending' }; }
        if (signal?.aborted || !isActive()) break;
        if (result !== false && result?.ok !== false) return result;
        if (recoveryCancelled(result) || result?.reason === 'recovery-exhausted') return result;
        if (!shouldRecover(result, cause)) { if (cause) throw cause; return result; }
        attempt++;
        let repaired;
        try { repaired = await recoveryStep(() => repair?.(result, cause), signal); } catch { /* 修复失败不能算作已经取得进展。 */ }
        if (signal?.aborted || !isActive()) break;
        if (repaired?.completed === true) return repaired.value;
        const progressed = repaired === true || repaired?.changed === true;
        // 错误措辞变化和无关配置通知都不是修复证据。
        // 本地幂等操作只允许一次无进展重试；付费请求由调用方禁用这一次。
        let resumed = false;
        if (!progressed && recoverySignalFor(global).revision !== revision) {
            try {
                const ready = await recoveryStep(() => canResume(result, cause), signal);
                resumed = ready === true || ready?.changed === true;
            } catch { /* 变化没有解除本次失败原因。 */ }
        }
        const retry = progressed || resumed || (retryUnchanged && !retriedUnchanged);
        if (retry) retriedUnchanged = true;
        let observed = recoverySignalFor(global).revision;
        try { onRecover?.({ attempt, result, phase: retry ? 'repairing' : 'waiting-condition' }); } catch { /* 展示不可阻止恢复。 */ }
        if (!retry) {
            let probes = 0;
            while (!signal?.aborted && isActive()) {
                if (observe) await wait(Math.min(maxDelayMs, initialDelayMs * 2 ** Math.min(probes++, 16)), { signal, global });
                else await waitForRecoveryChange({ signal, global, revision: observed });
                observed = recoverySignalFor(global).revision;
                if (signal?.aborted || !isActive()) break;
                let ready = false;
                try { ready = await recoveryStep(() => (observe || canResume)(result, cause), signal); } catch { /* 条件仍未解除。 */ }
                if (ready?.completed === true) return ready.value;
                if (ready === true || ready?.changed === true) break;
            }
            continue;
        }
        await wait(Math.min(maxDelayMs, initialDelayMs * 2 ** Math.min(attempt - 1, 16)), { signal, global });
    }
    return { ok: false, cancelled: true, reason: 'cancelled', stopGeneration: true };
}

// 服务成功结果跨保存重试复用；读取不缓存，始终取最新状态。
const GENERATED_STEPS = new Set(['generateCharacterSprite', 'generateCharacterAvatar', 'generateExpressionSet',
    'generateExpressionImage', 'paintExpressionCaptions', 'generateSceneVariants', 'writeWardrobePrompt',
    'paintWardrobeReference', 'importAssetImage', 'upload', 'importFile', 'generate', 'regenerate']);
export function checkpointService(service, checkpoint, prefix = '') {
    if (!service) return service;
    const strings = new Map();
    let sequence = 0;
    return new Proxy(service, { get(target, name) {
        const value = target[name];
        if (typeof value !== 'function') return value;
        if (!GENERATED_STEPS.has(name)) return value.bind(target);
        return (...args) => {
            const input = args[0] || {};
            if (typeof input === 'string' && !strings.has(input)) strings.set(input, ++sequence);
            const key = `${prefix}:${String(name)}:${JSON.stringify([input.name, input.character, input.outfit?.name || input.outfit,
                input.mood, input.moods, input.items?.map(item => item.mood), input.id, input.key, input.messageId, input.slot,
                input.time, input.weather, typeof input === 'string' ? strings.get(input) : ''])}`;
            return checkpoint.step(key, () => value.apply(target, args));
        };
    } });
}
