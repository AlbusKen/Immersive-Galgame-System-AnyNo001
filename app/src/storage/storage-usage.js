// 浏览器本地存储（localStorage）占用，按 IGS 的几类数据分组：存满时告诉用户空间被谁占了。
// 浏览器按 UTF-16 计，一个字符 2 字节；酒馆和各插件共用同一份额度（通常 5~10 MB）。
const OTHERS = '酒馆和其它插件';
const GROUPS = [
    ['素材预设', (key) => key === 'igs:scene-presets:v1'],
    ['IGS 设置', (key) => key === 'igs_bridge_config' || key.startsWith('igs-reader-settings-')],
    ['生图日志', (key) => key === 'igs_image_job_log'],
    ['IGS 其它', (key) => /^igs[-_:]/i.test(key)],
];

export function measureLocalStorage(storage) {
    const sizes = new Map();
    let total = 0;
    try {
        for (let i = 0; i < storage.length; i += 1) {
            const key = storage.key(i);
            if (key == null) continue;
            const size = (key.length + String(storage.getItem(key) || '').length) * 2;
            const group = GROUPS.find(([, test]) => test(key));
            const label = group ? group[0] : OTHERS;
            sizes.set(label, (sizes.get(label) || 0) + size);
            total += size;
        }
    } catch (error) { /* 读不了的部分不计 */ }
    return { total, groups: [...sizes].sort((a, b) => b[1] - a[1]) };
}

export function formatStorageSize(bytes) {
    return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

// 「本机存储已用 4.8 MB：素材预设 3.1 MB、IGS 设置 1.2 MB、…」；读不到时返回空串。
export function describeLocalStorageUsage(storage) {
    if (!storage || typeof storage.key !== 'function') return '';
    const { total, groups } = measureLocalStorage(storage);
    if (!total) return '';
    return `本机存储已用 ${formatStorageSize(total)}：${groups.map(([label, size]) => `${label} ${formatStorageSize(size)}`).join('、')}`;
}

export function describeMediaUsage(stats) {
    if (!stats?.cache) return '图片缓存状态暂不可用';
    const cache = stats.cache, lifecycle = stats.lifecycle || {};
    const mb = value => `${(Math.max(0, Number(value) || 0) / 1024 / 1024).toFixed(1)} MB`;
    const pending = (stats.records || []).reduce((sum, row) => sum + (row.dirty || 0), 0);
    return `内存 ${cache.memoryCount} 张 / ${mb(cache.memoryBytes)}（上限 ${mb(cache.memoryBudget)}）；本地 ${cache.diskCount} 张 / ${mb(cache.diskBytes)}（上限 ${mb(cache.diskBudget)}）；正在加载 ${cache.pending} 张；待备份 ${pending} 条；待回收 ${lifecycle.pendingDeletes || 0} 个文件（共享引用保护 ${lifecycle.protectedDeletes || 0}，失败待重试 ${lifecycle.failedDeletes || 0}）`;
}
