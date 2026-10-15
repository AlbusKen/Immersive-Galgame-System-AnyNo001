import { clonePromptData, IMAGE_PROMPT_TASKS, PROVIDED_PROMPT_DATA_FIELDS, validatePromptActivation } from './prompt-preset.js';

const fail = (reason, errors = []) => ({ ok: false, reason, errors });
const present = (value) => value !== undefined && value !== null && value !== '';

// 预览和发送共用：只在声明槽中替换一次，不求值注入资料里的占位符。
export function renderImagePromptPreset(data, task, input = {}) {
    const checked = validatePromptActivation(data);
    if (!checked.ok) return fail('prompt-not-activatable', checked.errors);
    if (!IMAGE_PROMPT_TASKS.includes(task)) return fail('unknown-image-prompt-task');
    if (!input || typeof input !== 'object' || Array.isArray(input)) return fail('invalid-prompt-data');
    if (input.contextMode !== undefined && input.contextMode !== 'provided') return fail('PROMPT_CONTEXT_MODE');
    const module = data.modules.find((item) => item.identifier === data.taskMap[task]);
    const fields = input.contextMode === 'provided'
        ? module.dataFields.filter(field => PROVIDED_PROMPT_DATA_FIELDS.includes(field)) : module.dataFields;
    // 禁止字段若被模块设为必需，明确拒绝，不读取该字段或悄悄回退。
    const missing = module.requiredFields.filter((field) => !fields.includes(field) || !present(input[field]));
    if (missing.length) return fail('missing-prompt-data', missing.map((field) => ({ field, reason: 'required' })));
    let context;
    try {
        context = clonePromptData(Object.fromEntries(fields
            .filter((field) => Object.hasOwn(input, field) && input[field] !== undefined)
            .map((field) => [field, input[field]])));
    } catch {
        return fail('invalid-prompt-data');
    }
    const byId = new Map(data.prompts.map((block) => [block.identifier, block]));
    const blocks = data.prompt_order.filter((entry) => entry.enabled !== false)
        .map((entry) => byId.get(entry.identifier)).filter((block) => block.enabled !== false)
        .map((block) => ({ identifier: block.identifier, role: block.role,
            content: block.kind === 'task-slot' ? module.content
                : block.kind === 'data-slot' ? JSON.stringify(context) : block.content }));
    const messages = blocks.map(({ role, content }) => ({ role, content }));
    return { ok: true, task, revision: data.revision, moduleId: module.identifier,
        blocks, request: { messages } };
}
