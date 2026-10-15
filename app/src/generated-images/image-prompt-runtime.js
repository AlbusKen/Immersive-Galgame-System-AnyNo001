import { createDefaultImagePromptPreset } from './image-prompt-defaults.js';
import { renderImagePromptPreset } from '../presets/prompt-preset-renderer.js';
import { runImageTask } from './image-task-runtime.js';
import { imageWritingContext } from './image-prompt-context.js';

// 注册表是唯一 current 真值；每次装配冻结本轮资料，不缓存另一份 current。
export function createImagePromptLlm(llm, registry, taskRuntime) {
    const wrapped = Object.create(llm || null);
    if (taskRuntime) wrapped.runImageTask = (meta, execute) => runImageTask(taskRuntime, meta, execute);
    wrapped.prepareImagePrompt = (task, input) => {
        const context = imageWritingContext(input);
        if (!context.ok) return context;
        const initialized = registry.ensureImagePromptDefault(createDefaultImagePromptPreset());
        if (!initialized.ok) return { ...initialized, error: '生图提示词预设不可读取或初始化失败，未发送写词请求' };
        const current = registry.getCurrent('prompt-preset');
        const rendered = renderImagePromptPreset(current?.data, task, context.value);
        return rendered.ok ? { ...rendered, presetId: current.id }
            : { ...rendered, error: '当前生图提示词预设或任务资料无效，未发送写词请求' };
    };
    if (typeof llm?.request === 'function') wrapped.request = llm.request.bind(llm);
    if (typeof llm?.fetchModels === 'function') wrapped.fetchModels = llm.fetchModels.bind(llm);
    return wrapped;
}

// 老的独立调用不添加可选字段；正式装配链才启用有序生图预设。
export function prepareImageWritingRequest(llm, task, input, legacy) {
    const context = imageWritingContext(input);
    if (!context.ok) return { ...context, stopGeneration: true };
    if (typeof llm?.prepareImagePrompt !== 'function') return { ok: true, request: legacy };
    try {
        const prepared = llm.prepareImagePrompt(task, context.value);
        return prepared.ok ? prepared : { ...prepared, stopGeneration: true };
    } catch {
        return { ok: false, reason: 'prompt-prepare-failed', stopGeneration: true,
            error: '生图提示词装配失败，未发送写词或绘图请求' };
    }
}
