import { SOURCE_RULE, IDENTITY_RULE, OUTFIT_RULE } from './common.js';

export const DNA_TASK = '只整理本轮明确要求的可复用身份资料，不生成完整画面或剧情 CG。';
export const DNA_DATA = [SOURCE_RULE, IDENTITY_RULE, OUTFIT_RULE,
    '按本次 promptTask 与 outputs.identityRequirements 交付缺失资料，不覆盖完整或主动清空身份；只在明确 sprite 用途中建立三景别候选。稳定性格独立写 personality，已有值及显式空值保持，仅缺键时提取，无依据可空。',
    '每份首行 slotid: 本轮编号，随后 character: 对应规范角色键、outfit_name、outfit_description。需要补身份时交 dna_full_body、dna_half_body、dna_portrait 及可选 dna_uc_对应景别；各身份主语非空且不超过4096字符，UC 可空。',
    '本槽 slotId 对应唯一 token，再取其 characterKey；不填别名、token 或译名。字段无索引、竖线或 meta_ 前缀。每份字段完整才以独立行 --- 分隔下一份，不输出 scene、char、镜头、姿势、背景、质量或完整绘图正文。',
    '三份身份来自同一完整外貌母版，只删除画外短语，不分别重写；衣装、灰尘、血污、临时伤势、当次表情与动作不进入身份或性格。最后逐槽核对原编号、角色键、必填字段与保存资料保真。',
].join('\n');
