# 后续接入 Notion 的准备

当前版本选择保持纯前端，已经实现 JSON 文件备份与一致性校验。Notion 登录、每日云同步及可信签名尚未实现；无需为文件备份创建 Notion 应用。

如果后续引入小型后端，可按以下步骤准备公共 OAuth 连接。菜单名称依据 [Notion 公共连接官方指南](https://developers.notion.com/guides/get-started/public-connections)。

1. 使用自己的 Notion 账号进入 Developer portal，在 Build 下选择 Public connections，再选择 Create new connection。
2. 应用名称填写 tcgStock，选择用于开发的工作区。先确定安装范围：Selected workspaces only 适合限定工作区试用；面向大众安装需选择 Any workspace。官方说明安装范围创建后无法修改，后续改变需新建连接。
3. 配置备份所需的内容读取、插入和更新权限。用户在 OAuth 授权页面自行选择可访问的 Notion 页面。
4. Redirect URI 应填写未来后端的真实 OAuth 回调地址，例如 `https://你的服务域名/auth/notion/callback`。GitHub Pages 页面不能替代用于保管密钥和交换令牌的后端回调。
5. 在 Configuration 获取 OAuth client ID 与 client secret。client secret 只放在后端部署平台的 Secret 中，不填写到 Vite 环境变量、公开仓库或备份文件里，也不需要发到聊天中。
6. 后端完成 OAuth state 校验、授权码交换和令牌保护后，再联调授权、选择备份页面、写入、读取、撤销授权和恢复校验。

详见 [Notion 授权流程](https://developers.notion.com/guides/get-started/authorization)。OAuth 只解决访问授权；要拒绝用户故意修改的账户记录，还需要可信端校验账户操作及签名，不能仅对客户端提交的任意余额生成签名。
