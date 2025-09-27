const express = require('express');
const path = require('path');
const fs = require('fs/promises');
const fss = require('fs');

const { transferItems, deleteItems } = require('../services/fileTransferService');
const { normalizeRelativePath, resolveVolumePath } = require('../utils/pathUtils');
const { extensions, mimeTypes } = require('../config/index');

const router = express.Router();

router.post('/files/copy', async (req, res) => {
  try {
    const { items = [], destination = '' } = req.body || {};
    const result = await transferItems(items, destination, 'copy');
    res.json({ success: true, ...result });
  } catch (error) {
    console.error('Copy operation failed:', error);
    res.status(400).json({ success: false, error: error.message });
  }
});

router.post('/files/move', async (req, res) => {
  try {
    const { items = [], destination = '' } = req.body || {};
    const result = await transferItems(items, destination, 'move');
    res.json({ success: true, ...result });
  } catch (error) {
    console.error('Move operation failed:', error);
    res.status(400).json({ success: false, error: error.message });
  }
});

router.delete('/files', async (req, res) => {
  try {
    const { items = [] } = req.body || {};
    const results = await deleteItems(items);
    res.json({ success: true, items: results });
  } catch (error) {
    console.error('Delete operation failed:', error);
    res.status(400).json({ success: false, error: error.message });
  }
});

router.get('/download', async (req, res) => {
  try {
    const { path: relative = '' } = req.query;
    if (typeof relative !== 'string' || !relative) {
      return res.status(400).json({ error: 'A file path is required.' });
    }

    const relativePath = normalizeRelativePath(relative);
    const absolutePath = resolveVolumePath(relativePath);
    const stats = await fs.stat(absolutePath);

    if (stats.isDirectory()) {
      return res.status(400).json({ error: 'Downloading directories is not supported yet.' });
    }

    res.download(absolutePath, path.basename(absolutePath), (err) => {
      if (err) {
        console.error('Download failed:', err);
        if (!res.headersSent) {
          res.status(500).send('Failed to download file.');
        }
      }
    });
  } catch (error) {
    console.error('Download request failed:', error);
    res.status(400).json({ error: error.message });
  }
});

router.get('/preview', async (req, res) => {
  try {
    const { path: relative = '' } = req.query || {};
    if (typeof relative !== 'string' || !relative) {
      return res.status(400).json({ error: 'A file path is required.' });
    }

    const relativePath = normalizeRelativePath(relative);
    const absolutePath = resolveVolumePath(relativePath);
    const stats = await fs.stat(absolutePath);

    if (stats.isDirectory()) {
      return res.status(400).json({ error: 'Cannot preview a directory.' });
    }

    const extension = path.extname(absolutePath).slice(1).toLowerCase();

    if (!extensions.previewable.has(extension)) {
      return res.status(415).json({ error: 'Preview is not available for this file type.' });
    }

    const mimeType = mimeTypes[extension] || 'application/octet-stream';
    const isVideo = extensions.videos.includes(extension);

    const streamFile = (options = undefined) => {
      const stream = options ? fss.createReadStream(absolutePath, options) : fss.createReadStream(absolutePath);
      stream.on('error', (streamError) => {
        console.error('Preview stream failed:', streamError);
        if (!res.headersSent) {
          res.status(500).end();
        } else {
          res.destroy(streamError);
        }
      });
      stream.pipe(res);
    };

    if (isVideo) {
      const rangeHeader = req.headers.range;
      if (rangeHeader) {
        const bytesPrefix = 'bytes=';
        if (!rangeHeader.startsWith(bytesPrefix)) {
          res.status(416).send('Malformed Range header');
          return;
        }

        const [startString, endString] = rangeHeader.slice(bytesPrefix.length).split('-');
        let start = Number(startString);
        let end = endString ? Number(endString) : stats.size - 1;

        if (Number.isNaN(start)) start = 0;
        if (Number.isNaN(end) || end >= stats.size) end = stats.size - 1;

        if (start > end) {
          res.status(416).send('Range Not Satisfiable');
          return;
        }

        const chunkSize = end - start + 1;
        res.writeHead(206, {
          'Content-Range': `bytes ${start}-${end}/${stats.size}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': chunkSize,
          'Content-Type': mimeType,
        });
        streamFile({ start, end });
        return;
      }

      res.writeHead(200, {
        'Content-Type': mimeType,
        'Content-Length': stats.size,
        'Accept-Ranges': 'bytes',
      });
      streamFile();
      return;
    }

    res.writeHead(200, {
      'Content-Type': mimeType,
      'Content-Length': stats.size,
    });
    streamFile();
  } catch (error) {
    console.error('Preview request failed:', error);
    if (!res.headersSent) {
      res.status(400).json({ error: error.message });
    } else {
      res.end();
    }
  }
});

module.exports = router;
