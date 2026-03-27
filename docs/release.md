# 发布说明

## 版本号

- 先修改 `package.json` 中的 `version`
- `scripts/postbuild.mjs` 会在构建后把该版本号写入 userscript header

## 发布前校验

```bash
npm install
npm run lint
npm test
npm run typecheck
npm run build
npm run size
```

## 产物

- 发布版：`dist/linuxdo-tool.user.js`
- 开发版：`dist/linuxdo-tool.dev.user.js`

`dist/` 为生成目录，默认不提交到源码仓库。

## GitHub 发布建议

1. 完成校验并构建发布版
2. 创建对应版本 tag 或 GitHub Release
3. 上传 `dist/linuxdo-tool.user.js` 作为 release asset

## 最小手工冒烟检查

- 面板能正常打开和关闭
- `Ctrl + Shift + L` 能切换面板
- 话题导出能成功生成 HTML
- 列表筛选规则能即时生效
- 自动阅读可以启动并停止
