# 第三方组件与素材 / Third-party components and assets

本应用源码未额外授予开源许可；下列依赖保持其原有许可证。锁文件记录精确依赖树，本表列直接依赖与开发工具，不代表将其重新许可。

Application source is not granted an additional open-source license. Dependencies retain their licenses. The lock file records the full dependency graph; this table lists direct dependencies and tooling.

| Package         | Installed version | Package license declaration |
| --------------- | ----------------- | --------------------------- |
| `@types/chrome` | 0.3.5             | MIT                         |
| `@types/node`   | 26.6.5            | MIT                         |
| `fflate`        | 0.8.2             | MIT                         |
| `playwright`    | 1.64.1            | Apache-2.0                  |
| `tsx`           | 4.23.15           | MIT                         |
| `typescript`    | 7.0.2             | Apache-2.0                  |

## 视觉资产 / Visual assets

- CopyPaste 品牌图标来自用户公司 [copypaste.hk](https://copypaste.hk/)，限本产品使用；不是开源品牌授权。
- Web/Admin/Desktop 的 Manrope 与 Fraunces 字体采用 SIL Open Font License；原许可证保留在相应 `public/fonts/` 或 `renderer/public/fonts/`。
- Lucide 图标采用其 npm 包所附 ISC 许可；图标源码不使用不明来源图片替代。
- 蓝色折叠纸带 PNG 由用户指定的本机 sub2-image-gen 工具生成，输出保留在 Web `output/imagegen/`，产品 public 中使用同一图像。运行脚本的个人网关密钥未复制到任何仓库。
- README 截图由本项目 delivery 验收工具实际拍摄，数据是本地 fixture，非真实客户资料。平台截图来自独立 Admin 客户端；delivery 拼图由实际四端截图排版，非生成的产品界面。

Brand artwork belongs to CopyPaste. Fonts preserve their OFL notices. The blue-fold raster was generated using the user-requested sub2-image-gen tool; no personal generation credentials were copied. Screenshots show the actual application with development fixtures.

## 原生运行依赖 / Native runtime dependencies

Windows Desktop packages contain Electron and its Chromium notices. FFmpeg/FFprobe are operator-installed external native tools, not embedded in these source repositories or Windows packages; confirm the selected binary's license for distribution. Codex is an externally installed, version-pinned runtime; it is not redistributed in these repositories.

Chrome host launch behavior follows the [official Chrome Native Messaging sample](https://github.com/GoogleChrome/chrome-extensions-samples/tree/main/api-samples/nativeMessaging) and [Electron Node-mode documentation](https://www.electronjs.org/docs/latest/api/environment-variables#electron_run_as_node). Windows local protection uses DPAPI CurrentUser; [Microsoft reference](https://learn.microsoft.com/en-us/dotnet/api/system.security.cryptography.protecteddata).
