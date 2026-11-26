# ei-feature-web

ei-feature-service 的 Web 控制台（Vue 3 + Element Plus + ECharts，Vite 构建）。页面规格见后端仓库 `redesign.html` 第 4 页第 11 节。

| 路由 | 内容 |
|---|---|
| `/features` | 特征表（按机台、状态、关键字筛选；“计算的机台”由绑定的 recipe 推导；展开看算子）；新增特征 / 算子（直接填 JSON 和代码，可顺带填名称）、修改名称（ID 不变、不评审）、提交评审、评审（算子需试跑）、下线、试跑（run_id 可直接输入，或按 时间 + fleet → 腔室 → recipe → 执行 逐级选） |
| `/bindings` | 左侧算子列表与筛选（特征、算子、recipe、状态）；右侧编辑绑定：fleet + 时间 → 勾选腔室 → 从这些腔室跑过的 recipe 中选（选好后不再反查机台 / 腔室，GDE 按 recipe 推送全部腔室）→ 算子版本、绑定 JSON、历史修订对比；导入 / 导出（v3） |
| `/schedules` | 树形表：特征 → 算子 → recipe → 机台 / 腔室（按特征、recipe、机台、腔室筛选；recipe 层看同步状态、进度，暂停 / 恢复、补算 / 重算）+ 计算批次（筛选、取消、详情） |
| `/results` | 按 recipe、机台、腔室、特征 → 算子、7 / 30 天看折线图（正常值 / 重算后的值 / 空值），点击点看来源，空值原因统计 |

## 运行

```bash
npm install
npm run dev          # http://localhost:5173 ，/api 代理到 http://127.0.0.1:8000（EI_FEATURE_API 可改）
npm run build        # 产物在 dist/，由网关托管，/api 转发到 ei-feature-service
```

## 离线演示（单个 HTML）

```bash
npm run snapshot        # 需要 ei-feature-service 在运行：抓数据快照到 src/api/offline-data.json
npm run build:offline   # 生成 offline/ei-feature-offline.html，双击即可打开，不需要网络和后端
```

离线页面的查询按快照数据在前端过滤；新增、评审、绑定提交等修改操作会提示“离线演示不能修改”，试跑返回快照里的示例结果。

## 约定

- 所有请求带 `X-Client: console`；`X-User` 由网关注入。
- 本地没有网关时，`.env.development` 中 `VITE_DEV_USER_SWITCH=true` 打开右上角的用户切换（alice / bob / carol 或自填），请求自带 `X-User`，便于演示“提交人 ≠ 评审人”。生产构建不会开启。
- 错误统一用 Element Plus 消息提示；`SPEC_INVALID`、`BINDING_INVALID` 的 `details.errors` 逐条显示在表单对应位置。
