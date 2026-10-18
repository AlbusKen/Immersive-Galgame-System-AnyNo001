import test from 'node:test';
import assert from 'node:assert/strict';
import { createImageBackend } from '../src/generated-images/image-backend.js';
import { createBuiltinImageTaskRuntime } from '../src/generated-images/builtin-image-task-runtime.js';
import { usesCharacterTemplates } from '../src/generated-images/illustration/character-prompt-task.js';
import { createAssetGenerationService, createAutoIllustrationService } from './helpers/media-fixtures.js';
import { createMemoryGeneratedAssetStore } from '../src/media/generated-asset-store.js';
import { createMemoryIllustrationStore } from '../src/media/illustration-store.js';
import { renderCharacterAssetList } from '../src/visual/igs-ui/settings-fields.js';

const caption = {
    v4_prompt: { caption: { base_caption: 'plugin composition, soft light',
        char_captions: [{ char_caption: 'purple hair, sitting, plugin outfit', centers: [{ x: 0.3, y: 0.7 }] }] } },
    v4_negative_prompt: { caption: { base_caption: 'plugin negative',
        char_captions: [{ char_caption: 'plugin character negative' }] } },
};
const dna = { version: 2, views: { half_body: { subject: 'silver hair', negative: 'red hair' } } };

function fixture(t) {
    const writes = [], paints = [];
    const assets = { characters: { Alice: {} }, characterDna: { Alice: structuredClone(dna) },
        characterDefaultOutfits: { Alice: { version: 1, outfitName: '校服' } },
        characterOutfits: { Alice: { 校服: { base: 'old.png', moods: {}, prompt: 'blue uniform' } } } };
    const bridge = { imageApi: { mode: 'dbgen' }, sceneAssets: assets };
    const api = {
        get getPromptCapabilities() { assert.fail('外部生成不得探测内置模板协议'); },
        async generateSinglePrompt(request) {
            writes.push(structuredClone(request));
            assert.ok(Object.keys(request).every(key => ['description', 'messageId', 'skipRecall', 'signal'].includes(key)));
            return { ok: true, value: { caption: structuredClone(caption),
                captions: [{ slotId: 1, caption: structuredClone(caption), anchorSentence: '二段。' }] } };
        },
        async generate(request) {
            paints.push(request);
            assert.deepEqual(request.caption, caption, '插件完整内容、人物和坐标必须保持');
            assert.equal(request.captionMode, undefined);
            assert.equal(request.capturePrompt, undefined);
            return { ok: true, value: [{ blob: new Blob(['fixture'], { type: 'image/png' }) }] };
        },
    };
    const registry = new Proxy({}, { get(_target, key) {
        if (key === 'onImagePromptChanged') return () => () => {};
        assert.fail('DBGen 不依赖 IGS 内置预设内容');
    } });
    const runtime = createBuiltinImageTaskRuntime({ readBridge: () => bridge, registry });
    t.after(() => runtime.dispose());
    const backend = createImageBackend({ global: { NaiDbGen: api, btoa }, taskRuntime: runtime,
        llm: { request() { assert.fail('不得用 IGS 副 LLM 接管 DBGen 写词'); } }, getBridge: () => bridge });
    const store = createMemoryGeneratedAssetStore();
    const service = createAssetGenerationService({ nai: backend, store, getSettings: () => bridge,
        messageHost: { getChatId: () => 'fixture' }, matte: async url => url });
    t.after(() => service.stop());
    return { assets, bridge, backend, service, writes, paints, store };
}

test('外部 DBGen：三景别不全仍由插件生成完整立绘、表情和头像，资料附带明确用途', async t => {
    const h = fixture(t), before = structuredClone(h.assets);
    assert.equal(h.backend.supportsCharacterTemplates(), false);
    assert.equal(usesCharacterTemplates(h.backend, dna), false);
    const sprite = await h.service.generateCharacterSprite({ name: 'Alice', dna,
        onOutfitDna() { assert.fail('外部生成不能被内置衣装资料回调阻断'); } });
    assert.equal(sprite.ok, true, JSON.stringify(sprite));
    const expression = await h.service.generateExpressionSet({ name: 'Alice', dna,
        outfit: { name: '校服', prompt: 'blue uniform' }, moods: ['喜悦'] });
    assert.equal(expression.items[0].ok, true, JSON.stringify(expression));
    const avatar = await h.service.generateCharacterAvatar({ name: 'Alice', dna });
    assert.equal(avatar.ok, true, JSON.stringify(avatar));
    assert.equal(h.writes.length, 3);
    assert.equal(h.paints.length, 3);
    for (const request of h.writes) {
        assert.match(request.description, /将所列设定逐项落实/);
        assert.match(request.description, /按角色名逐一对应/);
        assert.match(request.description, /完整提示词.*约定的字段与格式直接输出/);
        assert.match(request.description, /silver hair/);
        assert.doesNotMatch(request.description, /仅供|旧默认|优先于|不要|不能|禁止|不使用|不混合|"views"|"subject"|<<dna:|<<outfit:|meta_dna_|expression-fragments|sprite-data/);
    }
    for (const request of h.paints) assert.equal(request.replaceCharacterKeywords, true);
    const spriteRequest = h.writes[0].description;
    for (const requirement of [/下边缘落在腰胯/, /上边缘位于完整发顶上方/,
        /full_body.*完整全身取景.*portrait.*头颈双肩取景/, /头部、双肩和躯干一起正对镜头/,
        /双手参与幅度轻微/, /随身物件置于身体轮廓两侧/,
        /躯干轮廓与衣装主要结构清晰可见/, /人物轮廓外为透明区域/])
        assert.match(spriteRequest, requirement);
    assert.match(h.writes[1].description, /每种情绪分别设计.*使面部与身体共同表达/);
    assert.match(h.writes[2].description, /画面主体由完整头部、颈部和双肩组成.*下边缘落在肩线/);
    assert.match(h.writes[2].description, /本次头像只取可见特征/);
    assert.deepEqual(h.assets, before, '插件成品词不反推、改写 IGS DNA 或衣装资料');
    const saved = await h.service.getImagePrompt(sprite.imageId);
    assert.deepEqual(saved.caption, caption);
    assert.equal(saved.sentPrompt, undefined, '请求内容不能冒充外部插件最终发送快照');
});

test('外部 DBGen：有新 DNA 时只交本次景别、性格和当前衣装，旧字段全部留在本地', async t => {
    const h = fixture(t);
    const views = Object.fromEntries(['full_body', 'half_body', 'portrait'].map(key => [key,
        { subject: `1.2::silver hair::, ${key} identity, $5 hair clip,`, negative: `${key} exclusion` }]));
    const profile = { version: 2, identity: 'archived old identity', defaultAppearance: 'archived old dress',
        triggerWords: 'actor_trigger', personality: 'reserved and shy', negative: 'identity exclusion', views };
    h.assets.characterDna.Alice = profile;
    h.assets.wardrobe = { 校服: { prompt: 'blue uniform' } };
    const before = structuredClone(h.assets);
    assert.equal((await h.service.generateCharacterSprite({ name: 'Alice', dna: profile })).ok, true);
    assert.equal((await h.service.generateExpressionSet({ name: 'Alice', dna: profile,
        outfit: { name: '校服', prompt: 'blue uniform' }, moods: ['喜悦'] })).items[0].ok, true);
    assert.equal((await h.service.generateCharacterAvatar({ name: 'Alice', dna: profile })).ok, true);
    for (const [index, request] of h.writes.entries()) {
        const key = index === 2 ? 'portrait' : 'half_body';
        assert.equal(request.description.split(views[key].subject).length - 1, 1);
        assert.ok(request.description.includes(views[key].negative));
        for (const other of Object.keys(views).filter(other => other !== key)) {
            assert.ok(!request.description.includes(views[other].subject));
            assert.ok(!request.description.includes(views[other].negative));
        }
        for (const value of ['reserved and shy', 'blue uniform'])
            assert.equal(request.description.split(value).length - 1, 1, `请求 ${index} 的 ${value}：\n${request.description}`);
        assert.match(request.description, /正向词/);
        assert.match(request.description, /负向词/);
        assert.match(request.description, /固定外貌和当前衣装.*保持一致/);
        assert.match(request.description, /性格结合指定情绪/);
        assert.match(request.description, /与本图取景匹配的一份外貌资料/);
        assert.doesNotMatch(request.description, /archived old|actor_trigger|identity exclusion|旧默认|优先于|不要|不能|禁止|仅供|"views"|"subject"|"negative"|"outfit"/);
    }
    assert.deepEqual(h.assets, before);
    assert.equal(h.paints.length, 3);
    const noOutfit = await h.backend.writePrompt({ description: '画半身立绘。', imagePromptTask: 'sprite',
        characterContext: [{ characterKey: 'Alice', dna: profile }] });
    assert.equal(noOutfit.ok, true);
    assert.doesNotMatch(h.writes.at(-1).description, /archived old|actor_trigger|identity exclusion|旧|优先于/);
    assert.ok(h.writes.at(-1).description.includes(views.half_body.subject));
});

test('外部 DBGen：原有格式仍能交付自身资料，发送文本采用直接的字段用途说明', async t => {
    const h = fixture(t);
    const result = await h.backend.writePrompt({ imagePromptTask: 'sprite', description: '画半身立绘，穿新制服。',
        characterContext: [{ characterKey: 'Legacy', dna: { identity: 'legacy fixed identity',
            defaultAppearance: 'black hair, blue eyes, old coat', negative: 'red hair' },
        outfit: { name: '新制服', description: 'white uniform' } }] });
    assert.equal(result.ok, true);
    for (const value of ['legacy fixed identity', 'black hair, blue eyes, old coat', 'white uniform', 'red hair'])
        assert.equal(h.writes[0].description.split(value).length - 1, 1);
    assert.match(h.writes[0].description, /穿着按本次衣装的名称和说明描写/);
    assert.doesNotMatch(h.writes[0].description, /旧默认|优先于/);
    assert.equal(h.paints.length, 0);
});

test('智绘姬和柏宝绘：副 API 写词只收到一次按景别整理的资料，不再重复内部 DNA 对象', async () => {
    for (const mode of ['extension', 'baibai']) {
        const inputs = [], requests = [];
        const backend = createImageBackend({ getBridge: () => ({ imageApi: { mode } }),
            llm: { async prepareImagePrompt(_task, input) {
                inputs.push(input);
                return { ok: true, request: { user: input.description } };
            }, async request(request) {
                requests.push(request);
                return 'scene: 1girl\nchar: silver hair\nuc: red hair';
            } } });
        const result = await backend.writePrompt({ description: '画一个头像', imagePromptTask: 'avatar',
            characterContext: [{ characterKey: 'Alice', dna: { version: 2, views: {
                portrait: { subject: 'silver hair', negative: 'red hair' },
                full_body: { subject: 'UNUSED full body', negative: '' } } } }] });
        assert.equal(result.ok, true, JSON.stringify(result));
        assert.equal(inputs.length, 1);
        assert.equal(inputs[0].characterContext, undefined);
        assert.equal(requests[0].user.split('silver hair').length - 1, 1);
        assert.doesNotMatch(requests[0].user, /UNUSED|仅供|"views"/);
    }
});

test('外部 DBGen：剧情 CG 保留插件召回和完整内容，不要求人物旁路或内置格式', async t => {
    const h = fixture(t);
    let text = '[igs-scene:房间|白天|晴|NSFW]\n[igs-char:Alice|平和|一段。]\n二段。\n三段。';
    const service = createAutoIllustrationService({ nai: h.backend,
        llm: { request() { assert.fail('CG 必须继续由 DBGen 写词'); } },
        store: createMemoryIllustrationStore(), events: { emit() {} }, minBodyChars: 0,
        getSettings: () => ({ nsfwEnabled: true, nsfwCount: 1 }), getSceneAssets: () => h.assets,
        messageHost: { getChatId: () => 'fixture', readPreviousAiTexts: () => [],
            readFloor: () => ({ chatId: 'fixture', messageId: 5, swipeId: 0, isAi: true, isLatest: true, text }),
            writeFloor: async (_id, next) => { text = next; return { ok: true }; },
            on: () => () => {}, attachPromptStrip() {}, ensureMarkerRegexes: async () => ({ ok: true }), destroy() {} } });
    t.after(() => service.stop());
    const result = await service.processMessage(5);
    assert.equal(result.reason, 'done', JSON.stringify(result));
    assert.equal(h.writes.length, 1);
    assert.equal(h.writes[0].skipRecall, undefined, 'CG 的召回选择保留');
    assert.match(h.writes[0].description, /silver hair/);
    assert.doesNotMatch(h.writes[0].description, /dna_template|meta_identity|<<dna:/);
    assert.equal(h.paints.length, 1);
    assert.match(text, /\[igs-img:1\]/);
});

test('外部图源：即便声明了未来模板能力，也不启用 IGS 私有协议', () => {
    for (const mode of ['dbgen', 'extension', 'baibai'])
        assert.equal(usesCharacterTemplates({ describe: () => ({ mode }), supportsCharacterTemplates: () => true }, dna), false);
    assert.equal(usesCharacterTemplates({ describe: () => ({ mode: 'nai' }) }, dna), true);
});

test('外部图源：角色界面不将缺景别变成强制补齐入口', () => {
    const html = renderCharacterAssetList({ Alice: {} }, { imageSourceMode: 'dbgen', isOpen: () => true,
        characterDna: { Alice: dna }, sceneAssets: { characters: { Alice: {} }, characterDna: { Alice: dna } } });
    assert.doesNotMatch(html, />补齐三景别并生成立绘</);
    assert.match(html, />生成立绘</);
});

test('外部图源：内置一致性模板功能不会向 DBGen 索取新接口', t => {
    const h = fixture(t);
    assert.equal(h.backend.describeEdit().supported, false);
    assert.equal(h.writes.length, 0);
    assert.equal(h.paints.length, 0);
});

test('外部图源：切换来源后不把旧内置占位符直接送去计费出图', async t => {
    const h = fixture(t), unfinished = structuredClone(caption);
    unfinished.v4_prompt.caption.char_captions[0].char_caption = '<<dna:r0>> <<outfit:r0>>';
    const result = await h.backend.generateCaption({ caption: unfinished });
    assert.equal(result.reason, 'source-prompt-mismatch');
    assert.equal(h.writes.length + h.paints.length, 0);
});

test('外部图源：重画不会沿用内置旧图的最终发送证据', async t => {
    const h = fixture(t);
    const { promptSnapshotFromBody } = await import('../src/generated-images/final-caption.js');
    const sentPrompt = promptSnapshotFromBody({ model: 'nai-diffusion-5-full', parameters: caption }, null);
    const result = await h.service.generateExpressionImage({ name: 'Alice', mood: '喜悦', dna,
        caption: structuredClone(caption), exact: true, history: { captionMode: 'final', sentPrompt } });
    assert.equal(result.items[0].ok, true, JSON.stringify(result));
    const saved = await h.service.getImagePrompt(result.items[0].imageId);
    assert.deepEqual(saved.caption, caption);
    assert.equal(saved.sentPrompt, undefined);
    assert.equal(saved.captionMode, undefined);
});

test('外部 DBGen：普通写词失败保留错误码与定位，不回显插件私有正文', async () => {
    for (const code of ['PROMPT_LLM_UNSET', 'NAI_429', 'WORKBENCH_CAPTION_INVALID', 'DBGEN_PROMPT_EXCEPTION']) {
        const backend = createImageBackend({ getBridge: () => ({ imageApi: { mode: 'dbgen' } }),
            global: { NaiDbGen: { generate() { assert.fail('写词失败不得出图'); },
                async generateSinglePrompt() { return { ok: false, error: { code,
                    message: 'PRIVATE-MODEL-TEXT', context: { slotId: 2, status: 429, traceId: 'trace_safe', rawText: 'PRIVATE-BODY' } } }; } } } });
        const result = await backend.writeFloorPrompts({ description: '生成剧情 CG' });
        assert.equal(result.ok, false);
        assert.equal(result.reason, code);
        assert.equal(result.diagnostic.slotId, 2);
        assert.doesNotMatch(JSON.stringify(result), /PRIVATE-|rawText/);
    }
});
