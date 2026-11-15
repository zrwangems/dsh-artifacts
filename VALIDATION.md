# 验证记录（2026-11-15）

## Goal

- 项目目标见 `GOAL.md`。
- 真实 DSH 会话执行 `/goal 验证 DSH Artifacts：HTML/HTML-PPT 侧栏 PPT 式编辑、选中元素交给 Agent、revision 安全保存和历史恢复。`，界面返回 `Goal created / Status: active`。

## 自动化

- Node 22，`npm test`：9/9。覆盖工作区围栏、目录/文件符号链接、资源改写、流式媒体、原子保存、revision 冲突、12 路并发只成功一次、20 版历史上限与恢复、Agent 磁盘更新检测、opaque sandbox。
- Chromium，`npm run test:browser`：5/5。覆盖五类组件、原脚本及原 style 标签属性保留、公式和文本编辑、元素级 Agent 消息、PPT 新页/对齐/层级/保存、未保存预览。
- `npm audit --include=dev`：0 个已知漏洞。
- 性能冒烟：1000 个元素的 HTML 在 headless Chromium 中 1205ms 完成编辑组件加载。安装包约 1.6 MiB，运行时不请求 CDN；媒体按流响应。

## 真实 DSH Web

环境：`@deepseek-ai/dsh 0.2.2-rc.1`、Node 24.9.0、Linux、独立 Web profile，从 `.tgz` 安装。

实测通过：右侧栏 Artifacts 入口、项目文件列表、HTML 打开、标题选择、PPT 模式、新页、保存写回、历史版本生成、元素上下文显示、Agent 指令提交。当前会话返回“已把选中元素和指令交给当前 Agent”，浏览器无 `pageerror`。截图：`docs/dsh-artifacts.png`。

测试账号的模型 API Key 无效，因此只把“DSH 已接受 prompt”计为链路验收，不声称模型已成功生成修改。DSH Desktop / Windows 未做实机验证。

## 界面复审

根据真实使用截图重做视觉层级：移除 GrapesJS 默认设备栏、命令栏和样式面板外壳，统一自定义工具条、组件卡片、中文样式分区与 Agent 输入区。幻灯片使用独立的 1376×816 画布框，按侧栏可用宽高自动缩放和居中，切回网页时恢复坐标。新增浏览器断言确保完整画布不越界；最终 Host 9/9、Chromium 5/5。新版截图已替换 `docs/dsh-artifacts.png`。

## 独立审阅与勘误

使用独立 Codex 审阅 Host、客户端和编辑器：

1. 保存删除全部原 `<style>` 会丢失 `id/media/nonce`：确认，已改为仅替换插件生成的 `style[data-dsh-artifacts]`，原媒体条件包装进编辑 CSS，新增属性保留回归。
2. 目录符号链接可能递归泄露文件：未复现。`Dirent.isDirectory()` 对符号链接为 false，实现不会跟随；新增链接目录与外部 HTML 的列表测试，确认不返回外部文件。

开发中还修正：幻灯片画布变量 TDZ、页面选项卡未切换、GrapesJS 自动 id 覆盖稳定选择器、重复页稳定 id、同毫秒历史排序、同版本 pnpm 缓存导致实机仍加载旧客户端。最终自动化结果以上述全量回归为准。

## PPTX 模板导入（本轮）

- 以真实 `ITRC课题组模板.pptx` 验证：6 页、31 个独立文字框、13 张独立插图，输出 1280×720 的 `.slides > section[data-slide]`，无脚本和外部资源。
- 第 1、2、6 页与原 PPT 的 LibreOffice 参考图对照，1280×720 下平均像素绝对差分别为 3.39、1.85、5.20（0–255）；差异主要为浏览器与 LibreOffice 的字体抗锯齿。
- Host 最终 11/11：新增真实 PPTX 导入、重复输出拒绝、路径穿越和输出符号链接逃逸拒绝；原 9 项全部保持通过。
- Chromium 最终 6/6：新增 ITRC 原生 6 页导航、31 个文字框、13 张图片载入，标题修改、图片选择、层级调整及保存写回；原 5 项全部通过。
- 修复大体积内嵌图片首次载入时，页面列表早于 GrapesJS load 构建的问题；现在在编辑器 `load` 后激活页面并生成导航。
- `npm pack --dry-run` 确认转换脚本和依赖清单包含在包内，版本仍为 0.0.0；本轮不生成或交付新安装包。
- PPTX 导入实测环境具备 Python 3、LibreOffice 和 requirements 中依赖。其他操作系统的转换器安装已写入 README，Windows/Desktop 尚未实机验证。
