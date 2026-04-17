const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// Files live under <repo>/uploads so Nginx (root = /opt/chatsai/hostclaw) serves them at /uploads/*
const UPLOAD_DIR = path.resolve(__dirname, '..', '..', 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const ALLOWED_MIME = new Set([
  'image/jpeg', 'image/png', 'image/webp', 'image/gif',
  'video/mp4', 'video/quicktime', 'video/webm'
]);
const MAX_BYTES = 25 * 1024 * 1024; // 25MB

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase().replace(/[^a-z0-9.]/g, '');
    const id = crypto.randomBytes(10).toString('hex');
    cb(null, `${Date.now()}-${id}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_BYTES, files: 10 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME.has(file.mimetype)) return cb(null, true);
    cb(new Error(`Unsupported file type: ${file.mimetype}`));
  }
});

// POST /api/upload  — multipart field name "files"; returns { urls: [...] }
router.post('/', authenticate, (req, res) => {
  upload.array('files', 10)(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    const urls = (req.files || []).map(f => `/uploads/${f.filename}`);
    res.json({ urls });
  });
});

module.exports = router;
