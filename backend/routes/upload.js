const express = require('express');
const path = require('path');
const fs = require('fs/promises');

const { createUploadMiddleware } = require('../services/uploadService');
const { normalizeRelativePath } = require('../utils/pathUtils');
const { directories, uploads } = require('../config/index');
const { TUS_ENDPOINT_PATH } = require('../services/tusService');

const router = express.Router();

const uploadMethod = uploads.method;
const uploadMethods = uploads.methods;
const multerEnabled = uploadMethod === uploadMethods.MULTER;

router.get('/uploads/config', (req, res) => {
  res.json({
    method: uploadMethod,
    endpoints: {
      tus: TUS_ENDPOINT_PATH,
      multer: '/api/upload',
    },
    enabled: {
      tus: uploadMethod === uploadMethods.TUS,
      multer: multerEnabled,
    },
  });
});

if (!multerEnabled) {
  router.post('/upload', (req, res) => {
    res.status(405).json({ error: 'Multipart uploads are disabled on this server.' });
  });
  module.exports = router;
  return;
}

const upload = createUploadMiddleware();

router.post('/upload', upload.fields([{ name: 'filedata', maxCount: 50 }]), async (req, res) => {
  try {
    if (!req.files || !Array.isArray(req.files.filedata) || req.files.filedata.length === 0) {
      return res.status(400).json({ error: 'No files were provided.' });
    }

    console.log(req.files)
    /*
    prints like
    [
      {
        fieldname: 'filedata',
        originalname: 'OnyX.dmg',
        encoding: '7bit',
        mimetype: 'application/x-diskcopy',
        path: '/mnt/Projects/OnyX.dmg',
        size: 7062382
      }
    ]
    */


    const fileData = [];

    for (const file of req.files.filedata) {
      const stats = await fs.stat(file.path);
      const relativeFilePath = normalizeRelativePath(path.relative(directories.volume, file.path));
      const parentPath = normalizeRelativePath(path.dirname(relativeFilePath));
      const storedName = path.basename(relativeFilePath);
      const extension = path.extname(storedName).toLowerCase().replace('.', '');

      fileData.push({
        name: storedName,
        path: parentPath,
        dateModified: stats.mtime,
        size: stats.size,
        kind: extension,
      });
    }

    res.json(fileData);
  } catch (error) {
    console.error('Upload failed:', error);
    res.status(500).send('Server error');
  }
});

module.exports = router;
