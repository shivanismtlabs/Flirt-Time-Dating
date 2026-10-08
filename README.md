# FlirtTime Backend - Node.js + Express + PostgreSQL + Sequelize

A modern, production-ready RESTful API backend built with **Node.js**, **Express**, **PostgreSQL**, **Sequelize ORM**, and **TypeScript**.

---

## 🚀 Features

- **TypeScript Stack**: Strongly typed models, controllers, and middlewares.
- **Sequelize ORM**: Clean data modeling with PostgreSQL integration, connection pooling, auto-syncing, and type definitions.
- **Authentication & Security**:
  - JWT Bearer Token authentication (`jsonwebtoken`).
  - Password hashing (`bcryptjs`).
  - Role-Based Access Control (RBAC) middleware (`user`, `admin`).
  - Security headers via `helmet` and CORS configured.
- **Request Validation**: Schema validation using `zod`.
- **Clean Architecture**: Decoupled Controllers, Routes, Services, Middlewares, and Models.
- **Logging & Error Handling**: `morgan` HTTP request logger + global exception handling & 404 handler.

---

## 📁 Project Structure

```text
FlirtTime/
├── src/
│   ├── config/
│   │   ├── database.ts        # Sequelize DB connection & authentication
│   │   └── env.ts             # Centralized environment variable loader
│   ├── controllers/
│   │   ├── auth.controller.ts # Signup, login, & user profile logic
│   │   └── user.controller.ts # User CRUD controllers
│   ├── middlewares/
│   │   ├── auth.middleware.ts # JWT verification & role authorization
│   │   ├── error.middleware.ts# 404 & global error handlers
│   │   └── validate.middleware.ts # Zod request validation middleware
│   ├── models/
│   │   ├── user.model.ts      # User Sequelize model & interfaces
│   │   └── index.ts           # Model exports & DB sync helper
│   ├── routes/
│   │   ├── auth.routes.ts     # Auth endpoints (/api/auth)
│   │   ├── user.routes.ts     # User endpoints (/api/users)
│   │   └── index.ts           # Root API router
│   ├── schemas/
│   │   ├── auth.schema.ts     # Zod schemas for registration & login
│   │   └── user.schema.ts     # Zod schemas for user routes
│   ├── utils/
│   │   ├── jwt.ts             # JWT token helpers
│   │   ├── password.ts        # Bcrypt hash & comparison helpers
│   │   └── response.ts        # Standardized API response formatters
│   ├── app.ts                 # Express application setup
│   └── index.ts               # Server entry point
├── .env                       # Local environment configuration
├── .env.example               # Template environment configuration
├── .gitignore
├── package.json
└── tsconfig.json
```

---

## 🛠️ Setup Instructions

### 1. Prerequisites

- Node.js (v18+)
- PostgreSQL installed and running locally or via Docker/Cloud (e.g. Supabase, Render, Neon).

### 2. Configure Environment Variables

Edit the `.env` file in the root directory with your PostgreSQL connection details:

```env
PORT=5000
NODE_ENV=development

# PostgreSQL Database Settings
DB_HOST=localhost
DB_PORT=5432
DB_NAME=flirttime_db
DB_USER=postgres
DB_PASSWORD=your_postgres_password
DB_LOGGING=true
DB_SSL=false

# Authentication
JWT_SECRET=super_secret_jwt_key_flirttime_2026_change_in_production
JWT_EXPIRES_IN=7d
```

> **Note**: Create the database `flirttime_db` in PostgreSQL if it doesn't exist:
> ```sql
> CREATE DATABASE flirttime_db;
> ```

---

## 📜 Available Scripts

| Command | Description |
|---|---|
| `npm run dev` | Starts the server in development mode with auto-reload (`ts-node-dev`). |
| `npm run build` | Compiles TypeScript code to `./dist`. |
| `npm start` | Runs the compiled JavaScript application (`node dist/index.js`). |
| `npm run clean` | Removes the `./dist` build folder. |

---

## 🔗 API Endpoints

### 🩺 System
- **GET `/health`** - System & DB status check.

### 🔐 Authentication (`/api/auth`)
- **POST `/api/auth/register`** - Register a new user (`username`, `email`, `password`, `role`).
- **POST `/api/auth/login`** - Authenticate user & receive JWT token.
- **GET `/api/auth/me`** - Get current authenticated user profile *(Requires `Authorization: Bearer <token>`)*.

### 👤 User Management (`/api/users`)
- **GET `/api/users`** - List all users *(Requires Admin role)*.
- **GET `/api/users/:id`** - Get user by ID.
- **PUT `/api/users/:id`** - Update user details *(Requires Admin role)*.
- **DELETE `/api/users/:id`** - Delete user *(Requires Admin role)*.

---

## 🧪 Testing the API

You can test the server health endpoint once started:

```bash
curl http://localhost:5000/health
```

Sample Response:
```json
{
  "status": "UP",
  "timestamp": "2026-10-05T12:08:02.238Z",
  "database": "connected",
  "environment": "development"
}
```
