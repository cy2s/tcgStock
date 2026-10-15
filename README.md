# tcgStock · Riftbound 模拟交易

React HTML 版本。使用 RiftHunt 批量导出的美区英文卡牌与日级参考价，提供多模拟账户、USD 虚拟资金、买卖、手续费、持仓、账户分析、交易与充值记录、分享。

在线使用：[tcgStock](https://cy2s.github.io/tcgStock/) · [iOS 交互设计稿](https://cy2s.github.io/tcgStock/design/)

## GitHub Pages

网站由 `.github/workflows/pages.yml` 自动发布。推送到 `main`、手动运行工作流，以及每天北京时间 06:35 的计划任务都会触发构建。GitHub 定时任务可能延迟；卡牌价格日期会在页面上显示，超过 7 天的价格仍禁止交易。

构建任务读取两份 RiftHunt 批量导出文件，卡表缓存 24 小时、价格缓存 1 小时。卡图压缩为站内 WebP 文件，只补充尚未缓存的图片。访客加载站内 JSON 与卡图，搜索、刷新和模拟下单均不请求上游行情 API。若上游暂不可用，构建使用已保存的快照。站点只提供模拟交易，账户数据保存在各自浏览器，不会上传到仓库或在设备间同步。

本地生成与线上一致的静态版本：

```bash
npm ci
PAGES_BASE_PATH=/tcgStock/ npm run build:pages
```

`dist/` 可以部署到静态托管服务。仓库 Pages 的发布源选择 **GitHub Actions**。`public/card-images/` 保存压缩卡图；日常构建产生的新卡图和批量导出通过 Actions 缓存复用。

## 运行

需要 Node.js 20 或更新版本。在项目根目录执行：

```bash
npm install
npm run build
npm start
```

打开 http://127.0.0.1:4173/ 。`PORT=4180 npm start` 可修改端口。真实行情和本地卡图由 `server.mjs` 提供；直接双击 `dist/index.html` 无法使用接口。

交付压缩包已包含构建好的 `dist/`、批量行情快照和部分本地卡图。解压后可直接运行 `node server.mjs`，无需先执行构建命令。

## 数据与性能

- 卡表：使用 RiftHunt `/bulk/cards`，本地保存在 `data/rifthunt-cards.json`，最多每 24 小时从上游更新一次。价格：使用 `/bulk/prices`，本地保存在 `data/rifthunt-prices.json`，最多每小时更新一次。服务端多请求合并；上游暂时不可用时会使用已有本地文件。预置文件让初次启动无需等待下载。
- 卡图：浏览器只请求本站 `/api/card-image/:id`。已查看图片持久化到 `data/images/`，再次访问由本地读取，浏览器另缓存 7 天；未查看图片首次加载时才向卡图原站请求一次。首屏精选 5 张图已预置。`node scripts/warm-images.mjs --all` 可以低并发预热全部卡图，但文件较大，不是启动必需步骤。
- 卡图 URL 来自 RiftHunt 批量卡表；卡牌名称、图片等遵循 Riot Games 的同人内容规则。[RiftHunt API 与使用条款](https://rifthunt.com/api/)。
- 首版不接入 TickerMint，不提供个卡历史价格走势图，也不请求逐卡历史数据。估值和交易统一采用 RiftHunt。

## 模拟规则

- 新建账户现金为 $0，可模拟充值每笔 $0.01—$1,000,000。不同账户的现金、持仓、订单、充值及分析记录独立。所有数据保存在当前浏览器 `localStorage` 的 `tcgstock.rifthunt.v1`；尚无正式用户，因此不迁移早期原型数据。
- 按当前 RiftHunt 日级市场参考价模拟即时成交。普通与闪卡分开持仓；买卖均收取成交额的 2.5% 且每笔最低 $0.30。费用不可修改，可在确认页及订单详情查看。卡价缺失或超过 7 天时暂停交易。
- 北京时间每天 07:00—23:00 可模拟买卖，23:00—次日 07:00 闭市；充值与查看行情不受影响。周末使用同一规则。
- 账户分析：总收益率 =（当前总资产 − 累计模拟充值）÷ 累计模拟充值。累计盈亏曲线按北京日期记录实际观察到的账户估值，提供日线和周线；没有访问的日期不补造，RiftHunt 当前快照也无法还原历史价格。持仓缺价或尚未充值时，分析显示原因而不显示误导数字。

## 设计稿与检查

`design/index.html` 为 iOS 风格交互稿；`design/ios27-v7-rifthunt/` 是本次设计稿的独立副本。React HTML 是当前可用版本。

检查命令：`node --test src/*.test.mjs`、`npm run build`。
