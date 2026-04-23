# 后端API服务

基于 Node.js + TypeScript + Express 的 MVC 架构后端服务。

## 功能特性

- ✅ 用户注册（邮箱+密码）
- ✅ 用户登录（邮箱+密码）
- ✅ 微信快捷登录
- ✅ JWT Token 认证
- ✅ MySQL 数据存储

## 技术栈

- **运行时**: Node.js
- **框架**: Express
- **语言**: TypeScript
- **数据库**: MySQL + TypeORM
- **认证**: JWT (jsonwebtoken)
- **密码加密**: bcryptjs

## 项目结构

```
backend/
├── src/
│   ├── config/          # 配置文件
│   │   └── database.ts  # 数据库连接
│   ├── controllers/     # 控制器层
│   │   └── auth.controller.ts
│   ├── models/          # 数据模型层
│   │   └── User.model.ts
│   ├── routes/          # 路由层
│   │   └── auth.routes.ts
│   ├── services/        # 服务层
│   │   └── wechat.service.ts
│   ├── middleware/      # 中间件
│   │   └── auth.middleware.ts
│   └── index.ts         # 入口文件
├── package.json
├── tsconfig.json
└── README.md
```

## 安装和运行

### 1. 安装依赖

```bash
cd backend
npm install
```

### 2. 配置环境变量

创建 `.env` 文件（参考 `.env.example`）：

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

### 3. 创建数据库

在 MySQL 中创建数据库：
```sql
CREATE DATABASE run_app CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

### 4. 启动 MySQL

确保 MySQL 服务已启动，或使用云数据库服务。

### 5. 运行项目

开发模式：
```bash
npm run dev
```

生产模式：
```bash
npm run build
npm start
```

服务将在 `http://localhost:8666` 启动。

## API 接口

### 健康检查
- **GET** `/api/health`

### 用户注册
- **POST** `/api/auth/register`
  ```json
  {
    "username": "testuser",
    "email": "test@example.com",
    "password": "123456"
  }
  ```

### 用户登录
- **POST** `/api/auth/login`
  ```json
  {
    "email": "test@example.com",
    "password": "123456"
  }
  ```

### 微信登录
- **POST** `/api/auth/wechat`
  ```json
  {
    "code": "微信授权code"
  }
  ```

### 获取当前用户信息
- **GET** `/api/auth/me`
  - Headers: `Authorization: Bearer <token>`

## 响应格式

成功响应：
```json
{
  "message": "操作成功",
  "token": "jwt-token",
  "user": {
    "id": "user-id",
    "username": "username",
    "email": "email@example.com",
    "nickname": "nickname",
    "avatar": "avatar-url"
  }
}
```

错误响应：
```json
{
  "message": "错误信息"
}
```
