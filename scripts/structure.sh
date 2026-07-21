#!/usr/bin/env bash
# Step 3: create the project structure, adapted from
# https://dev.to/mr_ali3n/folder-structure-for-nodejs-expressjs-project-435l
set -euo pipefail

mkdir -p app/config app/database app/routes app/utils app/middleware app/models app/controllers app/helpers
mkdir -p public/dist public/images
mkdir -p samples
mkdir -p src/javascript src/css
mkdir -p tests

touch public/dist/.gitkeep public/images/.gitkeep src/javascript/.gitkeep src/css/.gitkeep

[ -f server.ts ] || cat > server.ts <<'EOF'
import 'dotenv/config';
import { createApp } from './app/config/app.conf.js';
import { logger } from './app/utils/Logger.util.js';

const port = Number(process.env.PORT ?? 3000);
const app = createApp();

app.listen(port, () => {
  logger.info(`Server listening on port ${port}`);
});
EOF

[ -f app/config/app.conf.ts ] || cat > app/config/app.conf.ts <<'EOF'
import express, { type Express } from 'express';
import { applyMiddleware } from '../middleware/App.middleware.js';
import { errorHandler } from '../middleware/ErrorHandler.middleware.js';
import { appRoutes } from '../routes/App.routes.js';

export function createApp(): Express {
  const app = express();
  applyMiddleware(app);
  app.use('/api', appRoutes);
  app.use(errorHandler);
  return app;
}
EOF

[ -f app/config/app.keys.ts ] || cat > app/config/app.keys.ts <<'EOF'
export const appKeys = {
  port: process.env.PORT ?? '3000',
};
EOF

[ -f app/config/db.conf.ts ] || cat > app/config/db.conf.ts <<'EOF'
// No database was selected during setup.
// Wire up app/database/Mongo.database.ts or Redis.database.ts here if one is added later.
export {};
EOF

[ -f app/config/db.keys.ts ] || cat > app/config/db.keys.ts <<'EOF'
// Placeholder for database credentials (e.g. process.env.MONGO_URI) once a database is added.
export {};
EOF

[ -f app/config/index.ts ] || cat > app/config/index.ts <<'EOF'
export * from './app.conf.js';
export * from './app.keys.js';
EOF

[ -f app/database/Mongo.database.ts ] || cat > app/database/Mongo.database.ts <<'EOF'
// No database was selected during setup.
// Install mongoose and implement a connection here if MongoDB is added later.
export {};
EOF

[ -f app/database/Redis.database.ts ] || cat > app/database/Redis.database.ts <<'EOF'
// No database was selected during setup.
// Install ioredis and implement a connection here if Redis is added later.
export {};
EOF

[ -f app/database/index.ts ] || cat > app/database/index.ts <<'EOF'
export {};
EOF

[ -f app/utils/Logger.util.ts ] || cat > app/utils/Logger.util.ts <<'EOF'
export const logger = {
  info: (message: string): void => console.log(`[INFO] ${message}`),
  error: (message: string): void => console.error(`[ERROR] ${message}`),
};
EOF

[ -f app/middleware/App.middleware.ts ] || cat > app/middleware/App.middleware.ts <<'EOF'
import express, { type Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';

export function applyMiddleware(app: Express): void {
  app.use(cors());
  app.use(helmet());
  app.use(morgan('dev'));
  app.use(express.json());
}
EOF

[ -f app/middleware/ErrorHandler.middleware.ts ] || cat > app/middleware/ErrorHandler.middleware.ts <<'EOF'
import type { NextFunction, Request, Response } from 'express';

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  const message = err instanceof Error ? err.message : 'Internal Server Error';
  console.error(err);
  res.status(500).json({ error: message });
}
EOF

[ -f app/middleware/index.ts ] || cat > app/middleware/index.ts <<'EOF'
export * from './App.middleware.js';
export * from './ErrorHandler.middleware.js';
EOF

[ -f app/models/User.model.ts ] || cat > app/models/User.model.ts <<'EOF'
import { randomUUID } from 'node:crypto';

export interface User {
  id: string;
  name: string;
  email: string;
}

const users: User[] = [];

export const UserModel = {
  findAll(): User[] {
    return users;
  },
  create(user: Omit<User, 'id'>): User {
    const created: User = { id: randomUUID(), ...user };
    users.push(created);
    return created;
  },
};
EOF

[ -f app/helpers/App.helper.ts ] || cat > app/helpers/App.helper.ts <<'EOF'
export function successResponse<T>(data: T): { success: true; data: T } {
  return { success: true, data };
}
EOF

[ -f app/controllers/App.controller.ts ] || cat > app/controllers/App.controller.ts <<'EOF'
import type { Request, Response } from 'express';
import { successResponse } from '../helpers/App.helper.js';

export const AppController = {
  health(_req: Request, res: Response): void {
    res.json(successResponse({ status: 'ok' }));
  },
};
EOF

[ -f app/controllers/User.controller.ts ] || cat > app/controllers/User.controller.ts <<'EOF'
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { UserModel } from '../models/User.model.js';

const createUserSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
});

export const UserController = {
  list(_req: Request, res: Response): void {
    res.json(UserModel.findAll());
  },
  create(req: Request, res: Response, next: NextFunction): void {
    const parsed = createUserSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    try {
      const user = UserModel.create(parsed.data);
      res.status(201).json(user);
    } catch (err) {
      next(err);
    }
  },
};
EOF

[ -f app/routes/App.routes.ts ] || cat > app/routes/App.routes.ts <<'EOF'
import { Router } from 'express';
import { AppController } from '../controllers/App.controller.js';
import { UserController } from '../controllers/User.controller.js';
import { authRoutes } from './Auth.routes.js';
import { dashboardRoutes } from './Dashboard.routes.js';

export const appRoutes = Router();

appRoutes.get('/health', AppController.health);
appRoutes.get('/users', UserController.list);
appRoutes.post('/users', UserController.create);
appRoutes.use('/auth', authRoutes);
appRoutes.use('/dashboard', dashboardRoutes);
EOF

[ -f app/routes/Auth.routes.ts ] || cat > app/routes/Auth.routes.ts <<'EOF'
import { Router } from 'express';

export const authRoutes = Router();

authRoutes.get('/', (_req, res) => {
  res.json({ message: 'Auth routes placeholder' });
});
EOF

[ -f app/routes/Dashboard.routes.ts ] || cat > app/routes/Dashboard.routes.ts <<'EOF'
import { Router } from 'express';

export const dashboardRoutes = Router();

dashboardRoutes.get('/', (_req, res) => {
  res.json({ message: 'Dashboard routes placeholder' });
});
EOF

[ -f samples/.env.sample ] || cat > samples/.env.sample <<'EOF'
PORT=3000
EOF

[ -f samples/db.conf.sample.ts ] || cat > samples/db.conf.sample.ts <<'EOF'
// Sample database configuration.
// Copy relevant values into app/config/db.conf.ts once a database is added to this project.
export {};
EOF

[ -f tests/UserModel.test.ts ] || cat > tests/UserModel.test.ts <<'EOF'
import { describe, expect, it } from 'vitest';
import { UserModel } from '../app/models/User.model.js';

describe('UserModel', () => {
  it('creates and lists users', () => {
    const user = UserModel.create({ name: 'Ada', email: 'ada@example.com' });
    expect(user.id).toBeDefined();
    expect(UserModel.findAll()).toContainEqual(user);
  });
});
EOF
