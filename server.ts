import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import path from 'path';
import fs from 'fs';
import multer from 'multer';
import db, { initDatabase } from './server/db.ts';
import { asyncHandler, authenticate, requirePasswordUpdated } from './server/helpers.ts';
import {
  registerPublicAndAuthRoutes,
  registerProfileNotificationsSettingsWarehouseRoutes,
} from './server/routes/publicRoutes.ts';
import { registerAnalyticsAndStaffRoutes } from './server/routes/analyticsRoutes.ts';
import { registerFranchiseeApplicationRoutes } from './server/routes/franchiseeRoutes.ts';
import { registerCommerceRoutes } from './server/routes/commerceRoutes.ts';
import { registerRestockingRoutes } from './server/routes/restockingRoutes.ts';
import { checkOverdueRestocks, runMonthlyRestockCheck } from './server/services/restockingService.ts';

const VALID_UPLOAD_CATEGORIES = new Set(['products', 'proofs', 'stores']);
const SAFE_FILENAME_RE = /^[a-zA-Z0-9._-]+$/;
const legacyUploadsDir = path.resolve(process.cwd(), 'server', 'uploads');

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '10mb' }));

  // Serve persisted product photos, store photos, and proof-of-delivery photos from Cloud SQL PostgreSQL
  app.get(
    '/uploads/:category/:filename',
    asyncHandler(async (req, res) => {
      const { category, filename } = req.params;
      if (!VALID_UPLOAD_CATEGORIES.has(category) || !SAFE_FILENAME_RE.test(filename)) {
        res.status(400).json({ message: 'Invalid file path.' });
        return;
      }

      const storageKey = `${category}/${filename}`;
      const fileRow = await db.queryOne<{ mime_type: string; data_base64: string }>(
        'SELECT mime_type, data_base64 FROM uploaded_files WHERE storage_key = $1',
        [storageKey]
      );

      if (fileRow) {
        const buf = Buffer.from(fileRow.data_base64, 'base64');
        res.setHeader('Content-Type', fileRow.mime_type);
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        res.send(buf);
        return;
      }

      // Safe fallback for any legacy static uploads bundled in server/uploads
      const candidatePath = path.resolve(legacyUploadsDir, category, filename);
      if (candidatePath.startsWith(legacyUploadsDir + path.sep) && fs.existsSync(candidatePath)) {
        res.sendFile(candidatePath);
        return;
      }

      res.status(404).json({ message: 'Image not found.' });
    })
  );

  const api = express.Router();

  // Health check responds immediately even while Cloud SQL scales up from zero
  api.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: 'AICE Franchisee Hub API', database: 'postgresql' });
  });

  // Ensure Cloud SQL PostgreSQL base data is initialized before handling DB-backed API routes
  api.use(async (_req, res, next) => {
    try {
      await initDatabase();
      next();
    } catch (err: any) {
      console.error('[Cloud SQL] Database unavailable for request:', err?.message || err);
      res.status(503).json({
        message: 'Database is starting up or temporarily unreachable. Please retry in a moment.',
      });
    }
  });

  // Public routes, login, /auth/me, and /auth/change-password
  registerPublicAndAuthRoutes(api);

  // All routes below require authentication and first-login password change completed
  api.use(authenticate, requirePasswordUpdated);

  registerProfileNotificationsSettingsWarehouseRoutes(api);
  registerAnalyticsAndStaffRoutes(api);
  registerFranchiseeApplicationRoutes(api);
  registerCommerceRoutes(api);
  registerRestockingRoutes(api);

  app.use('/api', api);

  // Error handler for Multer & API errors
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        res.status(400).json({ message: 'Image must be 5 MB or smaller.' });
        return;
      }
      res.status(400).json({ message: err.message });
      return;
    }
    if (err && err.message && String(err.message).includes('Only JPG, PNG, and WEBP')) {
      res.status(400).json({ message: err.message });
      return;
    }
    console.error('[API ERROR]', err);
    res.status(500).json({ message: err?.message || 'Internal server error.' });
  });

  const distPath = path.resolve(process.cwd(), 'dist');
  const distIndexPath = path.join(distPath, 'index.html');
  const runningBuiltServer = Boolean(
    process.argv[1]?.replace(/\\/g, '/').endsWith('dist/server.js')
  );
  const serveBuiltFrontend =
    (process.env.NODE_ENV === 'production' || runningBuiltServer) &&
    fs.existsSync(distIndexPath);

  if (!serveBuiltFrontend) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(distIndexPath);
    });
  }

  const PORT = Number(process.env.PORT) || 3000;
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`AICE Franchisee Hub running on http://0.0.0.0:${PORT}`);
    setImmediate(() => {
      initDatabase()
        .then(async () => {
          try {
            await checkOverdueRestocks();
            await runMonthlyRestockCheck(null, null, false);
          } catch (schedErr: any) {
            console.error('[RESTOCK SCHEDULER INIT ERROR]', schedErr?.message || schedErr);
          }
        })
        .catch((err) => {
          console.error('[Cloud SQL INIT ERROR]', err?.message || err);
        });
    });

    // Periodic automatic check (every 6 hours) for monthly restock window & overdue supplier deliveries
    const SIX_HOURS_MS = 6 * 60 * 60 * 1000;
    const schedulerTimer = setInterval(async () => {
      try {
        await initDatabase();
        await checkOverdueRestocks();
        await runMonthlyRestockCheck(null, null, false);
      } catch (schedErr: any) {
        console.error('[RESTOCK SCHEDULER ERROR]', schedErr?.message || schedErr);
      }
    }, SIX_HOURS_MS);
    schedulerTimer.unref?.();
  });
}

startServer();
