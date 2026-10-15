// 阅读器只协调任务与弹窗，不处理提示词、像素或持久化。
function progressText(detail = {}) {
    const labels = { prepare: '准备', reference: '读取参考立绘', write: '写提示词',
        paint: '局部重绘', compose: '合成候选' };
    if (!Object.hasOwn(labels, detail.phase)) return '';
    const count = Number.isInteger(detail.done) && Number.isInteger(detail.total)
        && detail.total > 0 && detail.done >= 0 && detail.done <= detail.total
        ? ` ${detail.done}/${detail.total}` : '';
    return `一致性重绘：${labels[detail.phase]}${count}…`;
}

export async function runCgConsistencyAction({ service, query, modal, signal: parentSignal, stillCurrent, onProgress }) {
    const controller = new AbortController(), signal = controller.signal;
    let candidateId = '', preflightToken = '', progress = null, dialog = null, generating = false;
    const cancelled = () => signal.aborted || !stillCurrent();
    const stop = () => controller.abort();
    const closeProgress = () => { generating = false; progress?.close(); progress = null; };
    const closeOwned = () => { closeProgress(); dialog?.cancel?.(); };
    parentSignal.addEventListener('abort', stop, { once: true });
    signal.addEventListener('abort', closeOwned, { once: true });
    if (parentSignal.aborted) stop();
    try {
        const cap = service.describeConsistency?.();
        if (!cap?.ok) return cap || { ok: false, reason: 'consistency-unavailable', error: '当前未接入角色一致性重绘' };
        if (cancelled()) return { ok: true, reason: 'cancelled' };
        let confirmed = false;
        if (service.preflightConsistency) {
            const ready = await service.preflightConsistency(query, { signal, shouldStart: () => !cancelled() });
            if (!ready?.ok) return ready || { ok: false, reason: 'consistency-unavailable' };
            preflightToken = ready.preflightToken || '';
            if (cancelled()) return { ok: true, reason: 'cancelled' };
            if (ready.reason === 'needs-confirmation') {
                const changes = ready.confirmations.map(c => `「${c.characterKey}」：要求「${c.requestedOutfit}」，将使用「${c.effectiveOutfit}」`).join('\n');
                dialog = modal.confirm(`以下衣装缺少可用人物立绘，将同时改用默认立绘和衣装 DNA，可能造成服装改变：\n${changes}\n是否继续本次重绘？`);
                confirmed = await dialog;
                dialog = null;
                if (!confirmed || cancelled()) return { ok: true, reason: 'cancelled' };
            }
        }
        if (cancelled()) return { ok: true, reason: 'cancelled' };
        generating = true;
        progress = modal.progress(progressText({ phase: 'prepare' }), stop);
        const result = await service.redrawConsistency(query, {
            signal, shouldStart: () => !cancelled(),
            ...(preflightToken && { preflightToken, confirmed }),
            onProgress: (detail) => {
                if (!generating || cancelled()) return;
                const text = progressText(detail);
                if (text) progress?.update(text);
                onProgress?.(detail);
            },
        });
        closeProgress();
        candidateId = result?.candidateId || '';
        if (cancelled()) return { ok: true, reason: 'cancelled' };
        if (!result?.ok) return result || { ok: false, reason: 'consistency-failed' };
        if (!candidateId || !result.dataUrl || !result.originalDataUrl) return { ok: false, reason: 'candidate-unavailable' };
        dialog = modal.confirmImage(result.dataUrl, '对比本次原图与一致性重绘候选（尚未保存）。接受后替换当前 CG，并保留首次修改前的基线图。',
            { okLabel: '接受', cancelLabel: '取消', originalImageUrl: result.originalDataUrl });
        const accepted = await dialog;
        dialog = null;
        if (!accepted || cancelled()) return { ok: true, reason: 'cancelled' };
        return await service.acceptConsistency(candidateId);
    } catch {
        return { ok: false, reason: cancelled() ? 'cancelled' : 'consistency-failed', error: '一致性重绘未确认保存，请重新读取当前 CG' };
    } finally {
        parentSignal.removeEventListener('abort', stop);
        signal.removeEventListener('abort', closeOwned);
        closeOwned();
        if (candidateId) service.cancelConsistency(candidateId);
        else if (preflightToken) service.cancelConsistency(preflightToken);
    }
}
