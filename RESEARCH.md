# 调研记录

## 2026-11-15：HTML-PPT 与选中元素 Agent

本轮按“PPT 手感 + 普通 HTML + 选中元素驱动 Agent + DSH 侧栏”重新筛选。Presenton 提供幻灯片编辑和 AI 修改，Onlook 提供网页可视化编辑和 AI 上下文，两者都是 Apache-2.0，但分别绑定自己的幻灯片工程与 Next.js/Tailwind 技术栈，不能直接往返普通 HTML。GrapesJS（BSD-3-Clause）仍是最小、许可清晰的通用 HTML 编辑内核。Lectern 用作交互参考；本轮没有复制 Presenton、Onlook、Lectern 或其他项目的业务源码。

实现选择：保留 GrapesJS 的拖拽、缩放手柄、图层、样式和撤销能力，新增单页幻灯片画布、布局快捷操作与稳定元素标识。Agent 链路直接使用 DSH 官方客户端 `Session.prompt`，避免自行模拟聊天事件或另接模型。选中上下文只包含当前项目文件与元素信息。

## 2026-11-12：通用 HTML 编辑

筛选条件按“近一周有 push、GitHub star > 100、能够作为 DSH 右侧栏渲染态 HTML 编辑器使用”同时判断，不把普通 HTML 生成器或源码编辑器算作满足。

| 项目 | 当时 star / 最近 push | 结论 |
|---|---:|---|
| [omdsh-dev/DSH-better-sidebar](https://github.com/omdsh-dev/DSH-better-sidebar) | 5116 / 2026-11-12 | 满足活跃度；HTML 沙箱预览和 CodeMirror 源码编辑，不是渲染态编辑，不满足功能。 |
| [ZSeven-W/dsh-openpencil](https://github.com/ZSeven-W/dsh-openpencil) | 258 / 2026-11-10 | 满足活跃度；编辑 `.op` 矢量设计文档，不编辑项目 HTML。 |
| [alienzhou/html-workbench](https://github.com/alienzhou/html-workbench) | 51 / 2026-11-11 | 最接近需求，DSH + GrapesJS + 文本/图片/样式；star 不达标，且无视频、图案、公式编辑。其 Python 服务也被本实现移除。 |
| [xiaobaiyg09/dsh-pickdom](https://github.com/xiaobaiyg09/dsh-pickdom) | 0 / 2026-08-23 | 有 DOM 框选和简单本地 HTML 编辑，但 star 与活跃度不达标，组件覆盖不足。 |
| [puckeditor/puck](https://github.com/puckeditor/puck) | 13688 / 2026-11-12 | 满足活跃度；React 组件编辑器，不是 DSH 插件，也不适合直接往返任意现有 HTML。 |
| [webstudio-is/webstudio](https://github.com/webstudio-is/webstudio) | 9169 / 2026-11-12 | 满足活跃度；完整网站构建平台，不是 DSH 插件，AGPL-3.0。 |
| [silexlabs/Silex](https://github.com/silexlabs/Silex) | 3036 / 2026-11-11 | 满足活跃度；独立静态网站平台，不是 DSH 插件，AGPL-3.0。 |
| [GrapesJS/grapesjs](https://github.com/GrapesJS/grapesjs) | 26402 / 2026-11-03 | 超过一周，但作为底层库很合适；BSD-3-Clause，直接编辑现有 HTML，最终复用。 |
| [givanz/VvvebJs](https://github.com/givanz/VvvebJs) | 8730 / 2026-07-01 | 超过一周；Apache-2.0，可备选，未采用。 |

另外检索了 DSH 插件市场收录信息、GitHub 的 `dsh html editor`、`visual editor deepseek harness`、`grapesjs dsh` 等组合，没有发现满足全部条件的现成插件。

## 复用决策

- GrapesJS：画布、组件、拖放、图层、样式、属性、撤销等成熟能力。
- KaTeX：LaTeX 解析，输出 MathML，保存后无 CDN 依赖，同时保留 LaTeX 供再次编辑。
- DSH 官方 `ui-sidebar-right` 公开 API：`sidebarRightTabs.register` + `sidebar.right.pane.tab`。
- 社区插件只用于核对宿主接入和生命周期模式；业务编辑器与 Host 文件服务为本项目实现。
