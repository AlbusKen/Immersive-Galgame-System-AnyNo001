
## R5 常驻氛围

验收：fx-atmos 5/5、date-ambience 4/4、fx-daily-vehicle-bath 17/17、fx-daily 14/14 通过；prompt-budget 2 条失败（kind 列表/触发词，非本轮改动，属其他代理）。新增样式文件 CRLF 为 0，无 canvas、无 url 型 mask；mask 仅用渐变；动画只用 transform/opacity；low 与 reduced 全部 animation:none。

- train/car/plane：暗角+光带 -> 窗框/立柱/A柱/舷窗+窗外景慢移。通过
- space：星点 -> 星球边缘光+大星分组闪烁。通过
- cloudsea：与 sky 同款 -> 日出金边+两层远山+慢云。通过
- inn：与咖啡厅同款 -> 梁柱+灯笼摇晃+酒气。通过
- cave：光点 -> 钟乳剪影+灵光脉动+错开水滴。通过
- cafe/beach/nightview：-> 虚化吊灯+杯口热气 / 海平线+浪边 / 天际线+光斑呼吸。通过
- 真机待看：多层叠加在低端机的合成开销、各 kind 与立绘遮挡关系。

## R1 快修

验收：fx-daily* 78 项过 76；2 条失败（modern era 古代专属 kind 列表被题材包新增 kind 撑大、fest-count-5-cn 超 5 秒）均非 R1 引起，属题材包；prompt-budget 另 2 条失败（展开总量、触发词覆盖）同属题材包新增 kind。三个文件 CRLF 为 0；fx-daily*.js 无 canvas、无 url 型 mask（仅渐变）；未见禁区文件被改。

- cook/fever/cat/rps/tea/go 音效：错配通用音 -> 各自合成音（热油叮、三短一长嘀、喵+呼噜、握拳啪、斟茶瓷响、棋子嗒）。通过
- guqin：lantern -> 已有 guqin 音色。通过
- alarm：读现实时钟 -> storyClock(env.sceneTime)（fx-daily.js:101，env 在 :994 接入 sceneTime），item.time 优先，读不到退回现实时间。通过
- reduced 兜底：guqin/go/tea/cook/poem/edict 在 reduced 下直接可见（fx-daily-style.js:355-359）。通过
- 死 CSS：ride/clean/shopping/stroll 等旧规则已删。通过（未逐类名复核引用，依实现者 grep 报告）
- bell 声波圈（low、reduced 隐藏，:167-168）/ broadcast 逐字揭示（reduced 全显 :171）/ note 限高：通过。note 的飞来贴上、撕下退场未做，留后续。
- 真机待看：bell 声波圈观感、broadcast 逐字速度、各新音效音量、闹钟读到场景时间的实际写法覆盖。

## R4 区间与镜头演出

验收：fx-runtime、romance-fx、fx-atmos、fx-relation(-medium)、fx-onomatopoeia、stage-direction、scene-audio、fx-prompts-style 全过；prompt-budget 2 条失败（展开总量、触发词覆盖）属题材包新增 kind，R4 未碰提示词。R4 改动文件 CRLF 为 0；无 canvas（落花瓣复用既有 startPetals，不作用于立绘）、无 url 型 mask（伞用 background 的 data-SVG）；未见禁区文件被改；基础打字机未动。验收时补修：reduced 下 dream 光点上浮、回忆胶片闪烁、cutin 立绘冲出改为静态（fx-range-style.js 末尾 reduced 段）。

- flashback：滤镜 -> 暖白收束闪+划痕+「回忆」角标+嚓声+BGM 让位（回忆每页转场、低通混响未做）。通过
- dream：雾团 -> 泛白淡入+光点上浮+立绘紫柔光+三层泛音+让位（立绘重影未做）。通过
- confess：黑边粉暗角 -> 落樱+立绘粉光+背景微虚化+进场抽空 BGM；离段/关闭停花瓣（句落抽空、答前呼吸未做）。通过
- cutin：小脸横条 -> 强调色实底+斜速度线+冲出回弹+两帧白闪+斩声；reduced/low 静态。通过
- letterbox：9% 黑边 -> 11% 黑边+背景 1.03 放大+咔咔两声。通过
- lightsoff：直接变暗 -> 余晖闪-灭-再亮-熄灭 1.6s（依赖 @property，不支持时退化为跳变，终态正确）；reduced 直接变暗。通过
- umbrella：半透明椭圆 -> 实色伞面+伞骨+锯齿缘+循环水珠（SMIL，low/reduced 静止）。通过，真机看 SMIL 渲染
- whisper：缩 97%+虚晕+压暗+气声（变慢打字机/前倾未做）。通过
- flash：单闪 -> 闪暗闪 1.4s+耳鸣让 BGM。通过
- nickname：数值提示条 -> 便签卡+胶带+头像+逐字书写+叮声（旧称呼划掉无数据未做）。通过
- 关系卡/回忆胶囊：半透明 -> 实色双层描边，动画未动。通过
- AI focus：背景虚化 -> 立绘加白柔光；视差与 camera-impact 联动未做。部分通过
- 真机待看：6 个新转场音的音色与音量、umbrella 水珠 SMIL、lightsoff 闪烁节奏、confess 花瓣与对话框遮挡、cutin 速度线观感。

## R2 立绘反应
- touch：仅暖光+爱心 -> 立绘心跳缩放(BEAT_FRAMES)+脸红偏色(add)，音 touch。通过
- pat：无专用音 -> 按头部锚点的手+立绘下压来回揉(PAT_FRAMES)+脸红，新专用音 pat。通过
- poke：捏脸 playSpriteSpec 经 spriteElOf 多人定位，reduced 下不播。通过
- cheers：立绘延迟 430ms 点头(CHEERS_NOD)，6 种材质各有碰杯音。通过
- cat：立绘俯身 2.4%/2.2deg 停留后还原，音 cat（喵+呼噜）。通过
- shower/steam/hairdry：湿身偏色、模糊、吹风晃动，均 reactSprite WAAPI add、reduced 返回 null。通过
- camera-impact：1.045 -> 1.075，峰 0.16，多一层 58Hz 低频尾，朝说话人头部放大(折中 0.7，夹 25-75/20-55)。通过
- stage-shake：3/6/10px -> 5/10/16px，时长加长，带 impact 音(调用方已传 playSfx)。通过
- 心跳 pulseSpriteBeat：按 0/0.2/1.1/1.3s 四拍缩放，紧张 0.032；reduced 与 low 画质直接返回。通过
- 体检：改动文件 CRLF 均为 0，无立绘 canvas/mask-image:url，未改标签语法与默认开关。fx-daily.js diff 含 R3/题材包 import 与其他轮改动，非 R2 删除。
- 遗留：tests/fx-daily-sfx.test.js 2 项失败，与 R2 无关（他轮新增 kind 未登记 EXPECTED：bow-sleeve/bubble-pop/carry-lift 等；campus 的 fest-count-5-cn 超 5 秒）。R2 的 pat/cat/clink-* 均已在 EXPECTED。
- 真机待看：心跳缩放与声音同拍感、camera-impact 朝头放大是否偏移、shake 16px 是否晕、pat 来回揉与发丝声同步、脸红/湿身偏色是否过重。

## R3 古风修仙
- yujian：一道斜掠剑光 -> 剑立起+立绘克隆站剑上飞向右上+云气留后+落点气浪；reduced 下无克隆、剑静置 46%、云气 .85 可见，兜底成立。通过
- qinggong：单个冲刺 -> cloneSpriteLayer 三道真残影(青灰偏色渐隐)+落叶+风线，音 soar+light-step；reduced 下残影静态、叶/线隐藏。通过
- dianxue：涟漪 -> 指光射穴位+红点炸开+经络依次闪+立绘灰蓝定住(克隆)，音 freeze-point；reduced 下仅红点与定格不播。通过
- guqin：飘音符 -> 古琴入画七弦十三徽，拨弦轻颤+墨纹+空山雾，立绘低头；low/reduced 水纹隐藏。通过
- tea/go/edict/bow：茶盏被衣袖递向对面并点头、棋盘落子+朱砂标+判词章、圣旨玉轴展开+玺、行礼立绘躬身+墨晕+礼字印；各有专用音；reduced 下直接终态。通过
- biguan/yungong：灵气循环仅 biguan 一处，low 下静态，reduced 隐藏灵点；yungong 成败分色，暖光克隆 reduced 不建。通过
- tend/opendoor/shield/carry/bubble：线稿图标/木门/盾弧/花瓣/气泡串，立绘 WAAPI add 联动，实色，reduced 终态。通过
- 删旧 CSS 复核：误删一处，igs-dfx-edict-scroll/rod/body 仍被 fx-harem.js(封位榜) 引用，已在 fx-harem-style.js 补局部样式还原卷轴外观(修)。其余被删类(go-stone/tea-cup/*-stage/yujian-blade 等)仅旧 builder 使用，无外部引用。
- 死代码：fx-daily.js 删除 15 个旧内联 builder(含 bubble)及 BOW/LIFT/FREEZE/DASH/GUARD_SPEC 五个孤儿常量，Object.assign 覆盖的新实现为唯一入口。
- 体检：CRLF=0，无 canvas/mask-image:url，未改标签语法与默认开关；共享文件 diff 中其他删除来自他轮。
- 遗留：tests/fx-daily-sfx.test.js 的 fest-count-5-cn(校园)超 5 秒、fx-daily-ancient.test.js 的 ANCIENT_ONLY 清单被他轮 kind 撑大，均与 R3 无关；其余 86 项通过。
- 真机待看：御剑立绘克隆与原立绘交接是否跳变、三道残影间距、点穴灰蓝定格观感、古琴比例与拨弦声同步、harem 圣旨卷轴还原是否与旧版一致。
