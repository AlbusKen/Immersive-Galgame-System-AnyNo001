// 演出页「题材专属」里的「题材包」一节：数据驱动，读 scene/fx-packs.js 的元数据；每个有 kind 的包一行总开关，点 › 展开各 kind 勾选。
// 总开关关着时下面的勾选保留但不生效；包没有 kind（空壳）时整块不出现。
import { checkbox, rangeInput } from './settings-fields.js';
import { normalizeCameraSettings } from './fx-camera-model.js';
import { perfItem } from './fx-settings-fields.js';
import { DAILY_FX_LABELS, normalizeDailyFxSettings } from './fx-daily-model.js';
import { FX_PACKS_ACTIVE, packRequiresMet, packSwitchOn, packSwitchPath } from '../../scene/fx-packs.js';

const P = 'readerSettings';
const grid = (body) => `<div class="igs-source-filter-grid">${body}</div>`;

export function renderPackFields(reader, more) {
    if (!FX_PACKS_ACTIVE.length) return '';
    const src = reader && typeof reader === 'object' ? reader : {};
    const daily = normalizeDailyFxSettings(src.dailyFx);
    const rows = FX_PACKS_ACTIVE.map((pack) => {
        const on = packSwitchOn(pack, src);
        const blocked = pack.requires && !packRequiresMet(pack, src);
        const kinds = grid(pack.kinds.map((kind) => checkbox(`${P}.dailyFx.${kind}`, daily[kind], DAILY_FX_LABELS[kind])).join(''));
        const note = blocked ? '需先开启亲密演出' : (daily.enabled ? '' : '需先开启日常演出');
        return perfItem(more, `pack-${pack.id}`, checkbox(`${P}.${packSwitchPath(pack)}`, on, pack.label), { on, hint: note, detail: kinds });
    }).join('');
    const cameraOn = FX_PACKS_ACTIVE.some((pack) => pack.id === 'camera');
    const camera = normalizeCameraSettings(src.cameraPackFx);
    const cameraSound = cameraOn ? perfItem(more, 'pack-camera-sound', checkbox(`${P}.cameraPackFx.sound`, camera.sound, '脚步与心跳声'), { on: camera.sound, hint: '默认关，音量比环境音低', detail: rangeInput(`${P}.cameraPackFx.volume`, camera.volume, '脚步声音量') }) : '';
    const follow = perfItem(more, 'pack-panel-skin', checkbox(`${P}.dailyFx.panelSkin`, daily.panelSkin, '面板卡片跟随对话框皮肤'), { hint: '公告、榜单等面板，默认按世界观换皮' });
    return rows + cameraSound + follow;
}
