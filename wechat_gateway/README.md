# PVHOT 微信登录态隔离原型

该目录实现一个独立、默认只监听 `127.0.0.1` 的实验网关。它固定验证5个来源：光伏們、索比光伏网、中关村储能产业技术联盟、天合光能和阳光电源。

## 重要边界

- 当前登录与文章列表适配器使用仍可访问的 WeWe RSS 微信读书桥 `weread.111965.xyz`。WeWe RSS 已归档，因此这只是验证登录态、调度和PVHOT数据契约的原型，不是永久上游。
- 原型默认不进入PVHOT生产数据；只有显式设置 `PVHOT_ENABLE_WECHAT_GATEWAY=1` 后，`fetch_wechat.js` 才会合并它的输出。
- 只保存标题、发布时间、封面和原文链接，不镜像公众号全文。
- 不进行自动账号轮换，也不尝试绕过微信的登录或频率限制。出现风控后进入退避状态。

## 本地运行

```bash
npm install
npm run wechat:gateway
```

打开 `http://127.0.0.1:4399`。首次启动会在 `.wechat-gateway-data/admin-token` 生成管理令牌；将其粘贴到页面后生成二维码并用微信扫码。会话令牌使用本地随机AES-256密钥加密，密钥和状态目录均被Git忽略。

服务输出兼容PVHOT微信数据契约的 `wechat_gateway_items.json`。观察期内可以单独检查：

```bash
curl http://127.0.0.1:4399/health
```

## 观察通过后接入

在运行现有微信任务时设置：

```bash
PVHOT_ENABLE_WECHAT_GATEWAY=1 node fetch_wechat.js
```

网关条目会与搜狗结果按规范化原文链接去重。搜狗通道仍会运行并承担降级发现，不会被原型替换。
