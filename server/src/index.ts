import express from 'express';
import path from 'path';
import fs from 'fs';
import { api } from './routes';

const app = express();
const PORT = Number(process.env.PORT) || 8687;

// Tautulli may send application/json or application/x-www-form-urlencoded.
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

app.use('/api', api);

// Serve the built React client (production).
const PUBLIC_DIR = process.env.PUBLIC_DIR || path.join(__dirname, '..', 'public');
if (fs.existsSync(PUBLIC_DIR)) {
  app.use(express.static(PUBLIC_DIR));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
  });
}

app.listen(PORT, () => {
  console.log(`[seenr-bridge] listening on :${PORT}`);
  console.log(`[seenr-bridge] webhook endpoint: POST /api/webhook/tautulli`);
});
