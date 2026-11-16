# 原理图工作室（schematic-studio）

一个零依赖、零构建的浏览器端原理图编辑器：用纯 HTML / CSS / 原生 ES Modules 编写，
由一个小型静态服务器托管，可直接在 Chrome / Edge 中运行。

## 功能

- **原理图绘制与编辑**：放置符号、连续画线、自动结点、标签与文本、框选 / 拖动 / 删除、网格吸附、撤销重做。
- **符号库**：内置电阻、电容、电感、二极管、LED、三极管、电源符号、开关、连接器、晶振、运放、IC 等。
- **封装库与封装绘制**：内置常见贴片 / 插件封装，提供焊盘与丝印绘制、图层配色与焊盘编号管理。
- **连通性分析与网表导出**：按导线、引脚、junction、标签与电源符号推导网络，导出 JSON / CSV / KiCad / Protel 网表。
- **导出**：SVG（矢量）与 PNG（位图，支持倍率）导出。
- **工程持久化**：工程 JSON 保存 / 打开、localStorage 自动备份，完整撤销与重做。

## 运行

```bash
node server.mjs
# 或
npm start
```

然后浏览器访问 <http://localhost:8080>（设置环境变量 `PORT` 可更换端口）。
无需 `npm install`，项目没有任何第三方依赖。

## 测试

```bash
npm test
```

等价于 `node --test`，直接以 Node.js 内置测试运行器执行 `test/` 下的用例。

## 目录结构

```text
sch/
├── index.html          # 应用外壳
├── server.mjs          # 零依赖静态服务器（导出 createServer 供测试）
├── package.json        # 无依赖，scripts: start / test
├── src/main.js         # bootstrap(root) 启动入口
├── core/               # ID、几何、事件总线、命令栈、schema
├── model/              # 工程数据与纯函数、状态仓库
├── library/            # 符号库与封装库（含内置数据）
├── netlist/            # 连通性分析与网表导出
├── render/             # 视图变换、画布渲染、主题、网格、符号绘制
├── editor/             # 吸附、可撤销命令、编辑器与工具
├── io/                 # 工程序列化、SVG / PNG 导出
├── ui/                 # 面板、工具栏、对话框与样式
├── docs/               # 架构说明与接口契约
└── test/               # node:test 用例
```

## 开发约定

- 纯原生 HTML / CSS / ES Modules；**零第三方依赖、零 CDN、零构建步骤**。
- 分层单向依赖：`core -> model/library -> netlist/render -> editor -> io -> ui`，禁止反向 import。
- `core`、`model`、`library`、`netlist`、`render/view.js`、`io/svg-export.js` 等纯函数模块禁止依赖 DOM，以便 `node --test` 直接测试。
- 代码风格：2 空格缩进、分号结尾、单引号、文件与目录 kebab-case、每个文件顶部一句职责注释。
- 接口签名以 [docs/CONTRACTS.md](docs/CONTRACTS.md) 为唯一权威；设计意图与分层规则见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。

## Git 约定

- 使用 conventional commits，格式 `<type>(<scope>): <简述>`（如 `feat(core): 新增几何工具`），一个提交只做一件事。
- 只暂存自己负责的路径，禁止 `git add -A`、`--amend`、`rebase`、`reset --hard`、切分支与 push。
- 提交前运行 `npm test`，保持历史可直接回溯、每个提交可独立构建运行。
