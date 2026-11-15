# DSH Artifacts

在 DSH 右侧栏打开项目里的 HTML / HTML-PPT，像 PPT 一样直接编辑渲染结果，并把选中的元素连同指令交给当前会话的 Agent。

## 安装

要求 DSH `>= 0.2.0`、Node.js `>= 20`。

```bash
git clone https://github.com/zrwangems/dsh-artifacts.git
cd dsh-artifacts
npm ci --include=dev
npm pack
dsh plugin --profile web add -w ./zrwangems-dsh-artifacts-0.2.0.tgz
```

重开 DSH Web，进入目标会话，在右侧栏选择 **Artifacts**。从文件列表打开 Agent 刚生成的 `.html/.htm`，也可以输入项目内相对路径。点击文件资源时，本插件也能认领 HTML 侧栏预览。

## 编辑

- 双击文字直接输入；拖拽移动，使用手柄缩放。
- 方向键移动 1px，Shift + 方向键移动 10px；Delete 删除，Ctrl/Cmd + D 复制。
- 工具栏支持复制、上移/下移层级、左对齐和水平居中。
- 左侧插入文本、图片、音视频、SVG 图案、LaTeX 公式和布局；右侧修改样式及媒体属性。
- 普通网页支持桌面、平板、手机宽度。幻灯片模式自动识别 `.slide`、`[data-slide]`、`.slides > section` 和顶层 `section`，提供页面导航、新建页面和 1280×720 单页画布。
- 撤销/重做、无脚本编辑画布、独立交互预览、Ctrl/Cmd + S 保存。

编辑画布不会执行原 HTML 脚本；预览会在没有同源权限的 sandbox 中执行。原 `<head>`、样式和脚本会保存回文件。

## 选中元素让 Agent 修改

1. 在画布中点选元素。插件为它写入稳定的 `data-dsh-artifact-id`。
2. 在 DSH 侧栏底部的“交给 Agent”输入要求，按 Ctrl/Cmd + Enter 或点击发送。
3. 当前会话会收到文件路径、稳定选择器、所在页、可见文本、计算样式和截断后的元素 HTML。Agent 直接修改同一个项目文件。
4. 编辑器每 4 秒检查磁盘。没有未保存修改时自动刷新；有未保存修改时保留你的画布并提示冲突，不会静默覆盖。

不选元素时，指令针对整份 Artifact。Agent 指令使用 DSH 当前会话的官方 `Session.prompt(..., 'queue')`，不会另开模型连接。

## 保存与版本

- 只允许读写当前会话工作区内的文件，规范路径和符号链接都不能逃逸。
- 保存使用 SHA-256 revision 乐观锁、同文件串行队列、随机临时文件和原子 rename。
- 每次保存前把磁盘版本写入 `.dsh/artifacts/<文档哈希>/`，保留最近 20 版。右侧“版本”可恢复，恢复本身也会先备份当前版本。
- HTML 上限 16 MiB，单个媒体上限 128 MiB；媒体响应采用流式传输，不把整段视频读入内存。
- 编辑 token 为 192 位随机值，预览 CSP 不包含 `allow-same-origin`。外部资源是否可访问仍取决于原 HTML 和网络环境。

## 开发

```bash
npm ci --include=dev
npm run build
npm test
npx playwright install chromium  # 首次
npm run test:browser
```

`dist/` 和 `lib/client.js` 会包含在 npm 包中，GrapesJS 与 KaTeX 全部本地打包，运行时不依赖 CDN 或 Python。

## 范围

自由布局适合绝对定位的 HTML-PPT；普通文档流 HTML 仍保留 GrapesJS 的拖放和样式编辑语义。当前不提供动画时间轴、多人同时编辑或 Markdown 反解。Windows/Desktop 使用相同 Host 与浏览器 API，但本仓库的实机验收记录以 Linux DSH Web 为准。

许可证：MIT。第三方许可见 [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md)。
