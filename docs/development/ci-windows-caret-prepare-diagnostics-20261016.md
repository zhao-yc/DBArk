# Windows安装补全：prepare失败的安全诊断

本修正基于ROOT固定`e0ccfa5c4d71081b0ce3c7591b56a8434310f087`，只改测试诊断，产品仍为原`0.19.0`。使用新的普通独立克隆`w01-ci-caret-diagnostics`及任务分支，没有使用工作树、修改ROOT、冻结w02或303队列目录。

## 原失败与修正

[原CI](https://github.com/zhao-yc/DBArk/actions/runs/38892945068/job/116947071143)的Windows packaged为71通过、1失败、245跳过，原退出1和安装清理记录保持。离线CTE补全用例在`cold=2`（第三个编辑器）的`positionMonacoCaret`保存正文断言收到空串，原5000ms超时；尚未进入该轮补全触发。附件前两轮成功截图及错误上下文已独立核对，仍不足以唯一归因产品、输入环境或准备时序。

此前`atCaret`在既有诊断try外，prepare失败无法留下阶段附件。现在把同一次调用放入try，标注`prepare`或`completion`阶段。catch仅采样并附白名单JSON，finally原样抛回原失败对象；采样或附件失败也不覆盖原错误，不重放输入。原失败截图与原始pageErrors附件改为安全指标，避免新诊断输出未知正文或错误原文；前两轮等原成功截图及所有成功断言保持。

## 诊断数据与未知边界

新增`tests/e2e/monaco-caret-diagnostics.ts`只读现有DOM、已初始化的Monaco公开API及`settings.get`，不读系统剪贴板、不改编辑器、不读取文件/凭据、不新增产品测试钩子。附件只有固定枚举、布尔、计数、UTF16长度和模型版本/选择状态，不返回SQL、草稿、DOM、URI、tab标识、异常message或cause。

- 可观察文档焦点、可见查询数、可见/聚焦编辑器数及补全状态节点数。
- 唯一可确认的可见/聚焦模型记录正文是否匹配本次marked、归一化UTF16长度、模型版本及选择数量/是否为空。
- main层仅记录本次`settings.get`活动tab是否存在/是否查询，以及保存正文是否匹配及长度。未公开模型到tab的对应标识，不把main活动tab强认作同一模型。
- renderer store没有现成公开读取接口，始终明确`unknown/no-public-store-interface`，不能用模型或main快照冒充它。
- 无模型API、多个候选、getter/IPC失败、缺少正文或page不可访问时，相应值保持`unknown/null`。仅实际读到空字符串才记录长度0。

这是失败后的单次顺序只读采样，不声称模型与main来自同一原子时刻，也不据其一次匹配/不匹配直接判断根因。没有新poll、sleep、准备等待或自动重试。

## 保留约束

`monaco-caret.ts`原blob保持，Ctrl+A/Backspace/insertText输入路径及原5000ms草稿断言不改；真实Ctrl+Space证明、13秒预算、三次独立冷编辑器、原case 90000ms、撤销和成功期待保持。Playwright配置、单worker/零retry执行策略、CI、安装脚本、src、版本及依赖/锁文件不改。317个正式完整身份逐项保持。

## 本轮验证

- 新10项纯测试覆盖白名单输出、CRLF/UTF16、空串与unknown区分、模型缺失/歧义、getter/IPC/page异常，以及实际正式测试体第三轮prepare失败的捕获和原错误保持。
- 原45项Monaco只读剪贴板/输入/当前光标证明回归保持，共55项通过，0失败/跳过。均为合成端口，不执行GUI或系统剪贴板。
- `tsc --noEmit`退出0。默认35门全0的真实Playwright `--list --trace=off`退出0，317个完整file/titlePath/projectName身份与原计划集合一致，244项静态跳过，执行0。
- 验证守卫禁止产品进程、网络、private env/key读取及密钥生成；只放行现有Rollup/esbuild编译器。首轮配置收集被守卫对`net use`的直接抛错阻断、未执行测试；随后将该调用保持禁止并走工具链原失败回调，完整55项通过，没有实际查询网络盘。
- 未构建或安装产物、未启动Electron/200、未重试或触发CI。忽略缓存保存纯报告、默认收集和守卫审计；原CI失败材料仍在原位置。

后续由ROOT把该测试专用头绑定同一0.19候选实际复验。此提交不声称修复原输入/同步问题，不将纯测试或默认列表算成CI/安装通过；如新诊断指向产品缺陷，另行报告并处理。
