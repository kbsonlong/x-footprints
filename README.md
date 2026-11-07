# X Footprints

X Footprints 是一款帮助你回看和整理 X 帖子的浏览器扩展。浏览帖子详情时自动记录访问足迹，可以按作者、内容和日期查找，导出记录，并用自定义 AI 模型总结筛选结果。支持 macOS Chrome 和 Safari；可通过自己的 Cloudflare R2 或其他 S3 兼容存储在多设备之间同步。

记录默认保存在浏览器本地。同步和 AI 总结需要自行配置并启用；iOS 真机、Safari 扩展及外部服务的端到端验证尚未完成。

## macOS Chrome 扩展

Chrome 版本与 Safari 版本共用采集和管理功能，各自使用浏览器独立的本地存储，可自行配置同步。需要 Chrome 109 或更新版本及 Node.js：

1. 在项目根目录运行 `node chrome/build.js`，生成 `build/chrome-extension`。
2. 在 Chrome 打开 `chrome://extensions`，启用右上角“开发者模式”，点击“加载已解压的扩展程序”，选择 `build/chrome-extension`。
3. 打开已登录且可访问的 X 帖子详情，点击工具栏中的 X Footprints 图标查看记录；可通过扩展菜单将其固定到工具栏。需要时在扩展详情页检查网站访问权限。
4. 修改共享代码后重新运行构建命令，并在 `chrome://extensions` 点击扩展的刷新按钮；已打开的 X 页面也需刷新。

Chrome 版本使用 Manifest V3 service worker，尚未完成真实 Chrome 和 X 网站的端到端验证。浏览器可能回收后台服务，未确认的采集消息可能丢失；本地数据、权限和隐身模式行为取决于 Chrome 设置。

## 跨设备同步与 AI 总结

在扩展弹窗或管理页面展开“同步与 AI 设置”。在每台设备分别填写相同的 S3 兼容存储 endpoint、bucket、region、object key 和访问密钥，勾选“自动同步”并保存，也可以点击“立即同步”。Cloudflare R2 的 endpoint 格式为 `https://<account-id>.r2.cloudflarestorage.com`，region 通常为 `auto`；其他服务填写其对应 region。使用 path-style 地址，账户需有该对象的读取和写入权限。自动同步在首次变更约 10 秒后合并上传，打开弹窗时检查更新，后台约每 15 分钟检查一次；失败后约 5 分钟重试。后台被回收时由约 1 分钟的备用定时器触发；浏览器或设备休眠、后台限制可能进一步延迟执行。同步会合并帖子及删除标记；请保持设备时钟准确，删除与重新访问按时间比较；超出本地上限的记录可能仍保存在远端。

填写支持 OpenAI Chat Completions 格式的完整 HTTPS 接口地址、模型名和 API key，保存后点击“总结当前筛选”。最多发送最近 100 条帖子，每条正文截取 2000 字符；总结结果显示在页面中，不会自动保存。模型服务可能产生费用并按其政策处理发送的数据。

密钥保存在各浏览器的扩展本地存储中，不随同步对象上传；同步数据本身未由扩展加密，存储服务可读取。仅使用可信的 HTTPS endpoint 和权限受限的密钥。扩展声明了 HTTPS 网站访问权限以支持自定义服务，Safari 可能要求用户授权。S3 服务需要支持条件 PUT（If-Match / If-None-Match），以及在适用时配置 CORS 允许 GET、PUT、Authorization、x-amz-date、x-amz-content-sha256、If-Match 和 If-None-Match，并暴露 ETag；模型服务也可能需要允许扩展来源的 CORS。真实 R2、其他 S3 服务及 AI 服务尚需用用户配置进行端到端验证。

## 本机运行

1. 在 Xcode 打开 `native/XFootprints/XFootprints.xcodeproj`，选择 `XFootprints` scheme 和 My Mac，运行 Debug。也可运行以下命令构建开发版：

```sh
xcodebuild -project native/XFootprints/XFootprints.xcodeproj -scheme XFootprints -configuration Debug -destination 'platform=macOS,arch=arm64' -derivedDataPath build CODE_SIGN_IDENTITY=- CODE_SIGNING_REQUIRED=NO build
open build/Build/Products/Debug/XFootprints.app
```

2. Safari 设置 → 高级，打开面向网页开发者的功能。Safari 设置 → 开发者，启用“允许未签名扩展”；Safari 重启后该设置需要重新打开。Apple Development 正式签名是否可用于本项目尚未测试。
3. Safari 设置 → 扩展，启用 X Footprints，并依 Safari 提示授权 x.com（及有需要的 twitter.com）。在 Safari 打开已登录可访问的帖子详情，打开工具栏的扩展弹窗检查记录。弹窗里的“在新标签页中管理”可打开宽屏管理页面，两种视图使用同一份本地数据。启用权限请由用户手动确认。

## iOS 开发与模拟器

打开 `native-ios/XFootprints/XFootprints.xcodeproj`，选择 XFootprints scheme 和 iPhone 模拟器。目标最低部署版本为 iOS 16；项目已在 iOS 26.3 模拟器构建并启动，但这不能证明 iOS 16 兼容。

```sh
xcodebuild -project native-ios/XFootprints/XFootprints.xcodeproj -scheme XFootprints -configuration Debug -destination 'platform=iOS Simulator,name=XFootprints Test iPhone' -derivedDataPath build-ios CODE_SIGNING_ALLOWED=NO build
```

真机运行需在 Xcode 中为应用和扩展配置有效的 Signing Team 与唯一 Bundle ID，签名通过后连接设备运行。安装后在 iOS 设置中找到 Safari → 扩展，启用 X Footprints 并授权 x.com；设置入口可能因系统版本而变化。真实 Safari 注入、导出、后台回收及 16 版系统尚未测试。

## 验证

```sh
node --test tests/*.test.js
```

`tests/popup-fixture.html` 使用模拟数据供浏览器查看弹窗，不能证明 Safari 扩展存储或真实 X 页面工作正常。`tests/*.test.js` 使用模拟 WebExtension API，不能替代 Safari 集成和真机测试。

## 当前限制

- Safari 实际启用、X 页面 DOM、导出下载、后台回收及长时间性能尚待端到端验证；iOS 16 真机兼容性尚未验证。
- 当前后台使用非持久页面和内存串行队列；后台进程被回收时尚未确认的消息可能丢失。存储写入错误不会在页面显示，弹窗修改失败才有提示。
- 清空只删除记录，保留设置；如果清空后继续浏览，会出现新记录。导出为当前筛选结果。CSV 为安全起见可能在公式样式的值前加单引号。
- 采集按 URL 里的账号名显示作者，正文定位依赖 X 当前页面结构。正文无法确认时保留 URL 与访问时间；标题在定位到正文区域后补充。配置同步或 AI 后记录会发送至对应服务，浏览原帖也会正常访问 X。
- 扩展从 1 至 2000 条可设上限，降低上限立即淘汰较旧记录。扩展权限和 Safari 存储的实际配额与持久性取决于浏览器及系统。
