# 快速启动指南

## 项目概述

这是一个完整的登录注册系统，包含：
- 前端：uni-app x 页面（登录/注册）
- 后端：Node.js + TypeScript + Express (MVC架构)
- 功能：普通注册登录 + 微信快捷登录

## 后端启动

### 1. 进入后端目录
```bash
cd backend
```

### 2. 安装依赖
```bash
npm install
```

### 3. 配置环境变量

创建 `.env` 文件：
```env
PORT=8666
JWT_SECRET=your-secret-key-change-this-in-production
MYSQL_HOST=localhost
MYSQL_PORT=3306
MYSQL_USER=root
MYSQL_PASSWORD=your-password
MYSQL_DATABASE=run_app
WECHAT_APPID=your-wechat-appid
WECHAT_SECRET=your-wechat-secret
```

### 4. 启动 MySQL

确保 MySQL 服务正在运行。如果没有安装 MySQL，可以：
- 安装本地 MySQL
- 或使用云数据库服务（如阿里云 RDS、腾讯云 MySQL 等）

### 5. 启动后端服务

开发模式：
```bash
npm run dev
```

服务将在 `http://localhost:8666` 启动。

## 前端配置

### 1. 配置 API 地址

编辑 `app/utils/api.ts`，修改 `BASE_URL`：
```typescript
const BASE_URL = 'http://localhost:8666/api'; // 或你的实际后端地址
```

### 2. 微信登录配置

在 `manifest.json` 中配置微信相关设置（如果需要微信登录功能）。

## 页面访问

### 登录页面
```
/pages/auth/login
```

### 注册页面
```
/pages/auth/register
```

## API 接口

### 注册
```
POST /api/auth/register
Body: {
  "username": "testuser",
  "email": "test@example.com",
  "password": "123456"
}
```

### 登录
```
POST /api/auth/login
Body: {
  "email": "test@example.com",
  "password": "123456"
}
```

### 微信登录
```
POST /api/auth/wechat
Body: {
  "code": "微信授权code"
}
```

### 获取用户信息
```
GET /api/auth/me
Headers: {
  "Authorization": "Bearer <token>"
}
```

## 注意事项

1. **后端地址**：确保前端配置的 API 地址与后端实际运行地址一致
2. **CORS**：后端已配置 CORS，允许跨域请求
3. **MySQL**：确保 MySQL 服务正常运行，并创建对应的数据库
4. **数据库同步**：开发环境下 TypeORM 会自动创建表结构，生产环境请使用 migrations
5. **微信登录**：需要配置有效的微信 AppID 和 Secret
6. **Token 存储**：登录成功后，token 会存储在本地，后续请求会自动携带

## 项目结构

```
run_app/
├── backend/              # 后端服务
│   ├── src/
│   │   ├── config/      # 配置
│   │   ├── controllers/ # 控制器
│   │   ├── models/      # 数据模型
│   │   ├── routes/      # 路由
│   │   ├── services/    # 服务层
│   │   └── middleware/  # 中间件
│   └── package.json
├── app/                  # 前端应用
│   ├── pages/
│   │   └── auth/        # 登录注册页面
│   ├── utils/
│   │   └── api.ts       # API 工具
│   └── pages.json       # 页面配置
└── QUICK_START.md        # 本文件
```

## 开发建议

1. 后端开发时使用 `npm run dev` 启动，支持热重载
2. 前端开发时在 HBuilderX 中运行项目
3. 使用 Postman 或类似工具测试 API 接口
4. 查看浏览器控制台和终端日志排查问题
