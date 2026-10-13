// 阅读器只协调任务与弹窗，不处理提示词、像素或持久化。
export async function runCgConsistencyAction({ service, query, modal, signal, stillCurrent, onProgress }) {
    let candidateId = '';
    const cancelled = () => signal.aborted || !stillCurrent();
    const stop = () => modal.cancel();
    signal.addEventListener('abort', stop, { once: true });
    try {
        const cap = service.describeConsistency?.();
        if (!cap?.ok) return cap || { ok: false, reason: 'consistency-unavailable', error: '当前未接入角色一致性重绘' };
        if (cancelled()) return { ok: true, reason: 'cancelled' };
        const result = await service.redrawConsistency(query, {
            signal, shouldStart: () => !cancelled(),
            ...(onProgress && { onProgress: (detail) => { if (!cancelled()) onProgress(detail); } }),
        });
        if (!result?.ok) return result || { ok: false, reason: 'consistency-failed' };
        candidateId = result.candidateId;
        if (cancelled()) return { ok: true, reason: 'cancelled' };
        if (!candidateId || !result.dataUrl || !result.originalDataUrl) return { ok: false, reason: 'candidate-unavailable' };
        const accepted = await modal.confirmImage(result.dataUrl, '对比本次原图与一致性重绘候选（尚未保存）。接受后替换当前 CG，并保留首次修改前的基线图。',
            { okLabel: '接受', cancelLabel: '取消', originalImageUrl: result.originalDataUrl });
        if (!accepted || cancelled()) return { ok: true, reason: 'cancelled' };
        return await service.acceptConsistency(candidateId);
    } catch {
        return { ok: false, reason: cancelled() ? 'cancelled' : 'consistency-failed', error: '一致性重绘未确认保存，请重新读取当前 CG' };
    } finally {
        signal.removeEventListener('abort', stop);
        if (candidateId) service.cancelConsistency(candidateId);
    }
}
