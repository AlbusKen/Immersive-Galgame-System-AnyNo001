import { SOURCE_RULE, OUTFIT_RULE } from './common.js';
import { TEMPLATE_RULE, PICTURE_RULE } from './template.js';
import { SPRITE_HALF_BODY_RULE } from '../prompt-registry.js';
import { EXPRESSION_FRAGMENTS } from './expression.js';

export const OUTFIT_TASK = '只处理指定角色的本套命名衣装与所需差分，不改变保存身份，不把剧情动作变成默认姿势。';
export const OUTFIT_DATA = [SOURCE_RULE, OUTFIT_RULE,
    '本轮只交衣装资料：每份首行 slotid: 本轮编号，随后 character: 该槽规范角色键、outfit_name: 本次衣装原名、outfit_description: 完整英文穿着谓语。按本槽唯一 token 对应 characterKey 绑定，不写别名或译名。',
    '每项字段各一次，直接写 字段名: 值，不带索引、竖线或 meta_ 前缀。完整写完一份才以独立行 --- 分隔下一份，单份不写分隔符。',
    '身份沿用已保存资料，不输出 dna_*、personality、scene、char、构图、姿势、背景、质量词或完整绘图词。不用临时身份描述或衣装说明填补缺失身份。',
    '交付前核对本轮槽号集合、规范角色键、衣装原名及独立说明；已有说明逐字保留，缺说明只完善本套衣装。',
].join('\n');
export const OUTFIT_TEMPLATE = [SOURCE_RULE, OUTFIT_RULE, TEMPLATE_RULE, PICTURE_RULE, SPRITE_HALF_BODY_RULE,
    '绘制指定命名衣装的单人立绘或表情差分。每个本轮 slot 对应一张独立图，只绑定本槽角色，身份与所需景别引用保存资料，不创建身份候选。',
    'named Char 使用自己的身份与适用衣装槽，再写指定表情及默认立绘姿势，不延续剧情动作、不叠穿默认衣装。单图字段完整后才分隔下一图，单图内部不写 ---。',
    '不输出 at、meta_identity、meta_signature、meta_dna_* 或临时校正字段。',
].join('\n');
export const OUTFIT_EXPRESSION = EXPRESSION_FRAGMENTS;
