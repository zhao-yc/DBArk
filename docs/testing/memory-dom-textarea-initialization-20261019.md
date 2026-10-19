# textarea内存端口初始化失败定位

基线为公开提交 `0f655b34aedf60480301c996bdaf345215b64881`。原CI `39203597956`／job `117901551805` 的 `ui-table-copy-structure.test.tsx:115` 失败：完整来源DDL期望不变，textarea.value实际为空；555文件中554通过、1失败，10438项通过、1失败、10跳过，类型检查通过，构建未执行。原解码日志SHA256为 `a1b27ae72703b6e09a0aa8cd53d3265b2db663ace81daa98ae5e1a7f9f97d7f9`。原CI、封存原件和旧原生现场不改、不重跑。

## 可控原因

前一完整通过基线 `1bb0f9fd57a72b8bd2cf25cd7cdabb6cf44f3c1e` 到本基线，产品差异只有 `sqlFormatting.ts`。对话框、其UI控制器、原失败测试和memory-dom四份文件逐字相同；测试中的SqlEditor由textarea端口替代，不执行真实格式化编辑器模块。

memory-dom原先将value、defaultValue及textContent保持为三个独立字段。当前实际ReactDOM 19.3.0的initTextarea先写defaultValue，再读取textContent；只有子文本与默认值一致且非空时，才写入当前value。原端口没有默认值到子文本的反射，首次挂载得到空值。后续updateTextarea会直接写当前value，因此额外一次更新可能遮蔽缺口。

真实对话框的read完成后提交来源，并设置clock；原effect也会读时钟再setClock。新增反例以显式deferred服务控制完成顺序：稳定时钟使setClock保持同值，修正前完整来源断言确定失败；递增时钟触发原effect更新，同一断言通过。没有加入sleep、延长超时、额外render或更换golden。没有旧CI逐次render轨迹，因此不声称旧轮实际是哪一次时钟差值；两基线均可在原React初始化函数下复现同一端口缺口。

修正前原件保留在本clone的 `.cache/textarea-evidence/before-fix*.json`：5项基础语义及稳定时钟UI反例失败；稳定/递增配对复现单独保留。旧CI失败不能用本地修正后结果回填。

## 精确端口适配

仅在MemoryDocument创建HTML textarea时安装值访问器。defaultValue来自直接文本子节点，setter替换子文本；未写value时当前值随默认子文本变化。写value即设置dirty标志，后续默认值或子文本不覆盖当前编辑值，API值按LF读回。普通input/div保持原独立字段行为，未增加产品或依赖改动。

合同依据：[WHATWG textarea](https://html.spec.whatwg.org/multipage/form-elements.html#the-textarea-element)。本端口只覆盖上述初始化、默认文本及dirty值行为，不提供完整浏览器、表单reset、克隆、布局或原生输入实现。

## 本地验证

- 目标2文件34项通过：原25项复制结构UI断言保留，增加稳定/递增时钟2项、textarea合同7项。
- 共享fixture的49个直接使用文件合计699项分批核验。首轮677通过、6项文件rename报EPERM、16项因另一个文件的原10秒beforeAll超时未执行；原输出保留。仅将这2个文件改用本clone自有TEMP/TMP及单worker，26项通过，未修改测试超时或产品代码。完整去重覆盖见本地交接文件，不将首轮写成全绿。
- `tsc --noEmit`退出0，产品、脚本、workflow、依赖及原失败断言保持。

本任务不执行GUI、端口、实库、原CI、build或push。React内存DOM及自有临时文件验证不能替代浏览器、安装版或新的完整CI验收。
