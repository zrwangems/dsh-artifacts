# Goal：DSH Artifacts

交付并合并一套可安装的 DSH 插件，让 Agent 生成 HTML / HTML-PPT 后，用户能在右侧栏直接编辑，并针对选中元素继续指挥同一会话的 Agent。

## 验收目标

- 原生右侧栏、项目 HTML 文件列表和 `.html/.htm` 资源认领。
- 普通网页与 16:9 幻灯片双画布；文字直改、拖拽、缩放、复制、对齐、层级、键盘微调和页面导航。
- 图片、音视频、SVG、公式、布局和样式编辑；撤销/重做、交互预览。
- 选中元素发送稳定 DOM 标识、路径、文本、样式与 HTML 上下文，通过 DSH 官方 Session prompt 交给当前 Agent。
- Agent 修改后的磁盘检测与干净画布自动刷新；脏画布不覆盖。
- SHA-256 revision、同文件串行化、原子保存、20 版历史恢复、路径与符号链接边界。
- 本地打包依赖、媒体流式响应、预览 sandbox、自动化测试、真实 DSH 验证、独立审阅与中文文档。

## 复用约束

优先许可明确的开源组件。GrapesJS 使用 BSD-3-Clause，KaTeX 使用 MIT。Presenton / Onlook / Lectern 只作产品与架构参考，不复制来源或许可未核实的代码。
