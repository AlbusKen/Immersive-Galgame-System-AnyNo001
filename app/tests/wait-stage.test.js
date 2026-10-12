import test from 'node:test';
import assert from 'node:assert/strict';
import {
    WAIT_STAGE_DEFAULTS,
    WAIT_STAGE_FALLBACK_LINES,
    WAIT_STAGE_GAME_LINES,
    WAIT_STAGE_GAMES,
    WAIT_STAGE_STYLE_TEXT,
    availableWaitStageGames,
    normalizeWaitStageSettings,
    waitStageGameLine,
    weaveWaitStageLines,
} from '../src/visual/igs-ui/wait-stage.js';
import {
    buildMemoryDeck,
    buildMoodRound,
    buildWaitStageModel,
    buildWhoSaidRound,
    collectWaitStageArt,
    collectWaitStageLines,
    rpsLineKey,
    rpsOutcome,
} from '../src/visual/igs-ui/wait-stage-runtime.js';

test('gate:wait-stage:settings-default-on-and-clamp-seconds', () => {
    const fallback = normalizeWaitStageSettings(null);
    assert.deepEqual(fallback, WAIT_STAGE_DEFAULTS);
    assert.equal(normalizeWaitStageSettings({ enabled: false }).enabled, false);
    assert.equal(normalizeWaitStageSettings({ games: false }).games, false);
    assert.equal(normalizeWaitStageSettings({ voice: false }).voice, false);
    assert.equal(normalizeWaitStageSettings({ lineSeconds: 1 }).lineSeconds, 3);
    assert.equal(normalizeWaitStageSettings({ lineSeconds: 99 }).lineSeconds, 16);
    assert.equal(normalizeWaitStageSettings({ lineSeconds: '8' }).lineSeconds, 8);
    assert.equal(normalizeWaitStageSettings({ lineSeconds: 'abc' }).lineSeconds, 6);
});

test('gate:wait-stage:weave-mixes-replay-and-fallback-without-double-quote', () => {
    const replay = [
        { who: '艾莉', text: '第一句。' },
        { who: '露娜', text: '第二句。' },
    ];
    let seed = 7;
    const random = () => {
        seed = (seed * 1103515245 + 12345) % 2147483648;
        return seed / 2147483648;
    };
    const out = weaveWaitStageLines(replay, WAIT_STAGE_FALLBACK_LINES, { random, limit: 8 });
    assert.equal(out.length, 8);
    for (let i = 1; i < out.length; i += 1) {
        assert.equal(Boolean(out[i].who) && Boolean(out[i - 1].who), false);
    }
    assert.equal(out.filter((line) => line.who).length, 2);
    assert.equal(out.filter((line) => !line.who).length, 6);
});

test('gate:wait-stage:weave-falls-back-when-no-replay', () => {
    const out = weaveWaitStageLines([], WAIT_STAGE_FALLBACK_LINES, { random: () => 0, limit: 4 });
    assert.equal(out.length, 4);
    assert.equal(out.every((line) => !line.who && line.text), true);
    assert.equal(out.every((line) => WAIT_STAGE_FALLBACK_LINES.includes(line.text)), true);
});

test('gate:wait-stage:collects-short-character-lines-and-drops-narration', () => {
    const turns = [
        { raw: '艾莉：[igs-char:艾莉|平和|要不要一起走？]' },
        { raw: '露娜：[igs-char:露娜|喜悦|好。]' },
        { raw: '她低下头，看着鞋尖，很久没有说话，风把她额前的头发吹到一边去了。' },
        { raw: '艾莉：[igs-char:艾莉|平和|要不要一起走？]' },
    ];
    const lines = collectWaitStageLines(turns, { random: () => 0 });
    assert.equal(lines.length, 2);
    assert.equal(lines.every((line) => line.who && line.text), true);
    assert.equal(new Set(lines.map((line) => line.text)).size, 2);
});

test('gate:wait-stage:collects-scene-directive-dialogue', () => {
    const lines = collectWaitStageLines([
        { raw: '[igs-scene:教室|白天|放学后]\n艾莉：[igs-char:艾莉|喜悦|你回来啦。]' },
    ], { random: () => 0 });
    assert.equal(lines.length, 1);
    assert.equal(lines[0].who, '艾莉');
    assert.equal(lines[0].mood, '喜悦');
    assert.equal(lines[0].text.includes('[igs'), false);
});

test('gate:wait-stage:long-line-is-skipped', () => {
    const long = '这是一句非常非常长的台词'.repeat(8);
    assert.equal(collectWaitStageLines([{ raw: `艾莉：[igs-char:艾莉|平和|${long}]` }]).length, 0);
});

test('gate:wait-stage:games-open-only-when-assets-allow', () => {
    const bare = availableWaitStageGames({}, []);
    assert.deepEqual(bare, ['rps']);
    const withPictures = availableWaitStageGames({ pictures: [{ url: 'a' }, { url: 'b' }, { url: 'c' }] }, []);
    assert.equal(withPictures.includes('memory'), true);
    const withSprites = availableWaitStageGames({
        sprites: [{ url: 'a', mood: '喜悦' }, { url: 'b', mood: '悲伤' }],
    }, []);
    assert.equal(withSprites.includes('mood'), true);
    const withLines = availableWaitStageGames({}, [
        { who: '艾莉', text: '一' },
        { who: '露娜', text: '二' },
    ]);
    assert.equal(withLines.includes('whosaid'), true);
    assert.equal(WAIT_STAGE_GAMES.every((id) => typeof id === 'string'), true);
});

test('gate:wait-stage:whosaid-needs-two-speakers', () => {
    assert.equal(buildWhoSaidRound([{ who: '艾莉', text: '一' }]), null);
    const round = buildWhoSaidRound([
        { who: '艾莉', text: '一' },
        { who: '露娜', text: '二' },
    ], () => 0);
    assert.ok(round);
    assert.equal(round.options.includes(round.answer), true);
    assert.equal(new Set(round.options).size, round.options.length);
});

test('gate:wait-stage:picks-memory-pairs-uniquely', () => {
    const deck = buildMemoryDeck([
        { url: 'a' }, { url: 'b' }, { url: 'a' }, { url: 'c' }, { url: 'd' },
    ], 3, () => 0);
    assert.equal(deck.length, 6);
    assert.equal(new Set(deck.map((card) => card.id)).size, 6);
    const counts = {};
    for (const card of deck) counts[card.url] = (counts[card.url] || 0) + 1;
    assert.deepEqual(Object.values(counts), [2, 2, 2]);
});

test('gate:wait-stage:mood-round-answer-is-in-options', () => {
    const sprites = [
        { url: 'a', mood: '喜悦' },
        { url: 'b', mood: '悲伤' },
        { url: 'c', mood: '愤怒' },
    ];
    const round = buildMoodRound(sprites, { random: () => 0 });
    assert.ok(round);
    assert.equal(round.options.includes(round.answer), true);
    assert.equal(round.sprite.mood, round.answer);
});

test('gate:wait-stage:rps-outcome-table', () => {
    assert.equal(rpsOutcome('rock', 'rock'), 0);
    assert.equal(rpsOutcome('rock', 'scissors'), 1);
    assert.equal(rpsOutcome('rock', 'paper'), 2);
    assert.equal(rpsOutcome('scissors', 'paper'), 1);
    assert.equal(rpsOutcome('paper', 'rock'), 1);
    assert.equal(rpsLineKey(0), 'draw');
    assert.equal(rpsLineKey(1), 'win');
    assert.equal(rpsLineKey(2), 'lose');
});

test('gate:wait-stage:game-line-falls-back-to-start-pool', () => {
    assert.equal(WAIT_STAGE_GAME_LINES.start.includes(waitStageGameLine('start', () => 0)), true);
    assert.equal(WAIT_STAGE_GAME_LINES.start.includes(waitStageGameLine('unknown-kind', () => 0)), true);
});

test('gate:wait-stage:builds-model-with-playlist-even-when-empty', () => {
    const model = buildWaitStageModel({ settings: { enabled: true }, random: () => 0 });
    assert.equal(model.playlist.length >= 1, true);
    assert.equal(model.settings.enabled, true);
    assert.equal(model.replay.length, 0);
    assert.deepEqual(model.games, ['rps']);
});

test('gate:wait-stage:collects-art-with-resolved-urls', () => {
    const art = collectWaitStageArt({
        characterOutfits: {
            艾莉: { 校服: { moods: { 喜悦: 'sprite-a' }, base: 'base-a' } },
        },
        scenes: { 教室: 'scene-a' },
    }, { resolveUrl: (url) => `resolved:${url}` });
    assert.equal(art.sprites.length, 1);
    assert.equal(art.sprites[0].url, 'resolved:sprite-a');
    assert.equal(art.sprites[0].mood, '喜悦');
    assert.equal(art.pictures.length, 2);
    assert.equal(art.pictures.every((item) => String(item.url).startsWith('resolved:')), true);
});

test('gate:wait-stage:style-layer-sits-above-dialog-below-toolbar', () => {
    assert.match(WAIT_STAGE_STYLE_TEXT, /#igs-overlay \.igs-waitstage\{position:absolute;inset:0;z-index:6/);
    assert.match(WAIT_STAGE_STYLE_TEXT, /prefers-reduced-motion/);
});
