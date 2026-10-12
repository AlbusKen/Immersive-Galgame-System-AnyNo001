import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

// 冷启动实际产物，不使用源码模块或替换媒体服务，避免原生 ESM 测试掩盖打包后的初始化错误。
export function checkBundleStartup(file, version) {
    for (const mode of ['auto', 'manual']) {
        const script = `
            globalThis.window = { IGS_AUTO_BOOTSTRAP: ${mode === 'auto'} };
            const bundle = await import(${JSON.stringify(pathToFileURL(file).href)});
            if (${mode === 'manual'}) bundle.bootstrapIGS({ global: window, autoAttachMagicWand: false });
            if (!window.IGS || window.IGS.version !== ${JSON.stringify(version)} || typeof window.IGS.openSettings !== 'function') {
                throw new Error('IGS startup did not create the expected public API');
            }
            window.IGS.destroy();
            await new Promise(resolve => setImmediate(resolve));
            process.exit(0);
        `;
        const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8', timeout: 15000 });
        if (result.error || result.status !== 0) {
            throw new Error(`Bundle startup failed (${file}, ${mode}): ${result.error?.message || result.stderr || result.stdout}`);
        }
    }
}
