# 我的创作台

把灵感、素材与作品，放在同一张画布。

这是用于个人创作的桌面工作台，提供项目管理、创作画布、AI 助手、素材与文档、图片/视频/音频生成，以及可配置的模型服务。本分支采用纸白与暖灰底色、墨绿点缀的简约界面。

## 使用

1. 安装桌面版本，选择或导入自己的项目目录。
2. 在设置中配置文本模型和媒体供应商。
3. 在画布中组织文字、图片、视频等节点，按所选模型能力连接素材并生成。
4. 通过素材、文档、助手和插件工具继续制作。

本次2.1.0只定制外观和产品展示：名称、图标、启动画面、首页、工作区、设置及关于页。模型调用、账号、节点、项目格式、已有配置和数据路径保持兼容。豆包实验通道保持原实现，没有将本次外观升级称为其稳定性修复。

## 开发与构建

使用仓库锁定的 Bun/TypeScript/Vue 依赖，参照 [开发说明](docs/development.md)。常用入口：

```powershell
bun install
bun run dev
bun run package:desktop
```

构建兼容原独立测试版的数据身份：

```powershell
$env:desktopVariant = 'doubaoTest'
$env:appVersion = '2.1.0'
bun run package:desktop
```

Windows产物为 `myStudio-2.1.0-Setup.exe`。覆盖升级时选择原安装目录，先关闭正在运行的应用。测试通道继续停用通用自动更新，不向上游发布源回退。

## 维护入口

- [品牌与兼容说明](docs/branding.md)
- [豆包接入规格与验证边界](docs/doubaoIntegration.md)
- [项目仓库](https://github.com/alnertodormilon-hue/Toonflow-app)

## 开源许可

基础项目使用 MIT 许可证，原始版权和授权保留在 [LICENSE](LICENSE)。本分支在 Toonflow 开源基础上定制，第三方许可随安装包分发，并可在“关于→开源许可与第三方声明”查看。内部包名及文件格式标记保留用于兼容，不作为产品展示名称。
