import test from 'node:test';
import assert from 'node:assert/strict';
import { extractSceneDirectives, applySceneClock } from '../src/scene/scene-directives.js';
import { clockMarksInText } from '../src/scene/time-bucket.js';

const scenesOf = (text) => extractSceneDirectives(text).directives.filter((d) => d.type === 'scene');

test('正文 14:30 覆盖时间栏，之前仍用时间栏', () => {
    const text = '[igs-scene:教室|夜晚|晴]\n夜很静。\n到了14:30，铃声响起。\n[igs-char:A|平和|我们走吧]';
    const [scene] = scenesOf(text);
    assert.equal(scene.clocks.length, 1);
    assert.equal(applySceneClock(scene, text.indexOf('夜很静')).time, '夜晚');
    assert.equal(applySceneClock(scene, text.indexOf('铃声')).time, '白天');
    assert.equal(applySceneClock(scene, text.length).time, '白天');
});

test('台词里的钟点和后写的钟点继续覆盖', () => {
    const text = '[igs-scene:教室|白天|晴]\n[igs-char:A|平和|下午两点了]\n后来已经晚上八点整。';
    const [scene] = scenesOf(text);
    assert.deepEqual(scene.clocks.map((c) => c.time), ['夜晚']);
    assert.equal(applySceneClock(scene, text.length).time, '夜晚');
});

test('一点点 / 有一点 / 差一点 / 第三点 不触发', () => {
    for (const s of ['有一点冷', '一点点', '差一点摔倒', '他想了三点原因', '第3点', '晚上一点冷', '下午有一点累', '比分2点5', '3.5点']) {
        assert.deepEqual(clockMarksInText(s), [], s);
    }
    const [scene] = scenesOf('[igs-scene:教室|夜晚|晴]\n她有一点点冷，差一点就哭了。');
    assert.equal(scene.clocks, undefined);
});

test('明确写法才认', () => {
    assert.equal(clockMarksInText('她看了眼表，十点半')[0].hour, 10);
    assert.equal(clockMarksInText('晚上十一点了')[0].hour, 23);
    assert.equal(clockMarksInText('早上7点钟')[0].hour, 7);
    assert.equal(clockMarksInText('2:30pm')[0].hour, 14);
});

test('换场景后重置，之后再出现钟点再覆盖', () => {
    const text = '[igs-scene:教室|夜晚|晴]\n14:30到了。\n[igs-scene:操场|黄昏|晴]\n风很大。\n[igs-char:A|平和|现在是早上六点]';
    const [a, b] = scenesOf(text);
    assert.equal(applySceneClock(a, text.indexOf('风很大')).time, '白天');
    assert.equal(applySceneClock(b, text.indexOf('风很大')).time, '黄昏');
    assert.equal(applySceneClock(b, text.length).time, '清晨');
});
