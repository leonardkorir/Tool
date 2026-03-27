# Tool
- 导出话题或用户动态为离线 HTML，支持 `clean` 和 `snapshot` 两种模式
- 按等级、分类、标签筛选列表页内容
- 自动阅读与可选自动点赞流程

当前脚本会注入到以下站点：

- `https://meta.discourse.org/*`

## 本地开发

要求：`Node.js >= 18`

```bash
npm install
npm run lint
npm test
npm run typecheck
npm run build
npm run size
```

构建结果：

- 开发版：`dist/linuxdo-tool.dev.user.js`
- 发布版：`dist/linuxdo-tool.user.js`

`dist/` 是生成目录，不作为源码提交内容保留。

## 安装到脚本管理器

1. 执行 `npm run build`
2. 打开 Tampermonkey 或 Violentmonkey
3. 导入 `dist/linuxdo-tool.user.js`

面板默认入口在页面右下角，快捷键为 `Ctrl + Shift + L`。

## 权限与边界

脚本当前会使用以下 Tampermonkey/Violentmonkey 能力：

- `GM_getValue` / `GM_setValue` / `GM_deleteValue`：保存配置
- `GM_addStyle`：注入最小 UI 样式
- `GM_download`：下载导出文件
- `GM_xmlhttpRequest`：资源内联时抓取外部资源
- `unsafeWindow`：复用 Discourse SPA 路由和单例守卫

资源内联开启时，脚本可能访问话题内容里引用到的外部资源域名。

## 常见问题

- `403/404`：通常是登录态、权限或话题可见性问题
- `429`：触发限流，建议降低资源内联强度或拉大请求间隔
- 离线图片缺失：通常是未启用内联，或启用了“仅用缓存”但资源未命中缓存

## 仓库结构

- `src/`：运行时代码
- `scripts/`：构建后处理与体积校验脚本
- `tests/`：Vitest 自动化测试
- `docs/release.md`：维护者发布说明

## 发布

版本号以 `package.json` 为准，构建时会自动写入 userscript header。发布说明见 [docs/release.md](docs/release.md)。
