// 阅读器只协调任务与弹窗，不处理提示词、像素或持久化。
export async function runCgConsistencyAction({ service, query, modal, signal, stillCurrent, onProgress }) {
    let candidateId = '';
    let progress = null;
    const cancelled = () => signal.aborted || !stillCurrent();
    const stop = () => modal.cancel();
    signal.addEventListener('abort', stop, { once: true });
    try {
        const cap = service.describeConsistency?.();
        if (!cap?.ok) return cap || { ok: false, reason: 'consistency-unavailable', error: '当前未接入角色一致性重绘' };
        if (cancelled()) return { ok: true, reason: 'cancelled' };
        if (!(await modal.confirm('按已保存的角色资料逐人重绘当前 CG？完成后先预览，接受才替换原图。粗区域内的背景与遮挡不保证不变。'))) return { ok: true, reason: 'cancelled' };
        if (cancelled()) return { ok: true, reason: 'cancelled' };
        progress = modal.progress('正在加载角色参考，原 CG 保持不变。', onProgress.stop);
        const result = await service.redrawConsistency(query, {
            signal, shouldStart: () => !cancelled(),
            onProgress(detail) {
                if (detail.phase === 'consistency') progress.update(`角色一致性重绘 ${detail.done + 1}/${detail.total}：${detail.characterKey}\n停止会丢弃本次候选；上游已发请求可能仍在执行。`);
            },
        });
        progress.close();
        if (!result?.ok) return result || { ok: false, reason: 'consistency-failed' };
        candidateId = result.candidateId;
        if (cancelled()) return { ok: true, reason: 'cancelled' };
        if (!candidateId || !result.dataUrl) return { ok: false, reason: 'candidate-unavailable' };
        const accepted = await modal.confirmImage(result.dataUrl, '一致性重绘候选（尚未保存）。接受后替换当前 CG，并保留本次修改前基线图。',{ okLabel: '接受', cancelLabel: '取消' });
        if (!accepted || cancelled()) return { ok: true, reason: 'cancelled' };
        return await service.acceptConsistency(candidateId);
    } catch {
        return { ok: false, reason: cancelled() ? 'cancelled' : 'consistency-failed', error: '一致性重绘未确认保存，请重新读取当前 CG' };
    } finally {
        signal.removeEventListener('abort', stop);
        progress?.close();
        if (candidateId) service.cancelConsistency(candidateId);
    }
}
