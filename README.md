# dsh-ui-visibility · 界面管理

把**左侧边栏条目**和**设置分区**按需显示/隐藏。

## 它管什么

- 左侧边栏（槽位 `sidebar.panellist`）：打分、小说工作台、任务日记…
- 设置分区（槽位 `settings.section`）：小说工程、写作槽位、角色指令…

## 它不管什么

**它不启停插件**。取消勾选只是注入 CSS 把那一行藏起来；插件本体照常加载，
它的 agent 工具、HTTP 路由都仍然可用。要真正禁用，请改 profile 的
`dsh.profile.bundles`（或插件管理器）。

## 实现口径（两个宿主的勾子不一样，必须分开）

| 槽位 | 宿主渲染 | 本插件怎么藏 |
| --- | --- | --- |
| `sidebar.panellist` | 侧栏按钮带 **`aria-label={label}`** | 注入 CSS：`[aria-label="…"]{display:none !important}` |
| `settings.section` | 分区按钮**没有 aria-label**，只有 `<span class="…navLabel">文本</span>` | **遍历 DOM** `button[class*="navCell"]`，按行内文本匹配后改 `style.display`；并用 `MutationObserver` 跟随弹层开合 |

> 设置那条最初也想用 CSS，实测选不中——因为设置分区按钮压根没有 `aria-label`。
> 类名形如 `VOzbGW_navCell`（**哈希前缀会变、`navCell` 后缀稳定**），所以选择器用 `class*="navCell"` 抗哈希。

后果：**同名条目会一起被藏**（无法区分 id）；设置分区按**界面上的文本**匹配，改语言/改标签要重开一次。

## 配置

存浏览器 localStorage：`dsh-ui-visibility:hidden:v1`

```json
{ "sidebar.panellist": ["dsh-longkong-score"], "settings.section": [] }
```

清掉这条 key 就全部恢复（面板里也有「全部显示」按钮）。

## 安装

```bash
dsh plugin --profile web add /workspace/dsh-ui-visibility
# 然后重启 DSH Web（服务端模块只在启动时加载）
bash /workspace/重启-dsh-web.sh
```

## 改完必须重启（重要）

DSH 把**所有插件的前端合并成一个 bundle**，在**启动时构建并缓存**。
所以：**改了 host 半要重启，改了 client 半同样要重启**——光刷新页面不会重新打包。

```bash
bash /workspace/重启-dsh-web.sh   # 然后 Ctrl+F5
```
