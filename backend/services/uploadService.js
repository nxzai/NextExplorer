const path = require('path');
const fs = require('fs/promises');
const fss = require('fs');
const multer = require('multer');

const { ensureDir, pathExists } = require('../utils/fsUtils');
const { normalizeRelativePath, resolveVolumePath } = require('../utils/pathUtils');
const { readMetaField } = require('../utils/requestUtils');

const resolveUploadPaths = (req, file) => {
  const relativePathMeta = readMetaField(req, 'relativePath');
  const uploadToMeta = readMetaField(req, 'uploadTo');

  const uploadTo = normalizeRelativePath(uploadToMeta);
  const relativePath = normalizeRelativePath(relativePathMeta) || path.basename(file.originalname);

  const destinationRoot = resolveVolumePath(uploadTo);
  const destinationPath = path.join(destinationRoot, relativePath);
  const destinationDir = path.dirname(destinationPath);
  const temporaryPath = `${destinationPath}.download`;

  return {
    destinationPath,
    destinationDir,
    temporaryPath,
  };
};

function CustomStorage(opts) {
  this.getDestination = opts.destination || function (req, file, cb) {
    cb(null, '/uploads/');
  };
}

CustomStorage.prototype._handleFile = function handleFile(req, file, cb) {
  this.getDestination(req, file, async (err) => {
    if (err) {
      return cb(err);
    }

    try {
      const { destinationPath, destinationDir, temporaryPath } = resolveUploadPaths(req, file);
      await ensureDir(destinationDir);

      const outStream = fss.createWriteStream(temporaryPath);
      file.stream.pipe(outStream);

      outStream.on('error', async (streamErr) => {
        try {
          if (await pathExists(temporaryPath)) {
            await fs.rm(temporaryPath, { force: true });
          }
        } catch (cleanupErr) {
          console.error('Failed to remove temporary upload file:', cleanupErr);
        }
        cb(streamErr);
      });

      outStream.on('finish', async () => {
        try {
          await fs.rename(temporaryPath, destinationPath);
          cb(null, {
            path: destinationPath,
            size: outStream.bytesWritten,
          });
        } catch (renameErr) {
          cb(renameErr);
        }
      });
    } catch (uploadError) {
      cb(uploadError);
    }
  });
};

CustomStorage.prototype._removeFile = function removeFile(req, file, cb) {
  fs.unlink(file.path).then(() => cb(null)).catch(cb);
};

const createUploadMiddleware = () => multer({ storage: new CustomStorage({}) });

module.exports = {
  createUploadMiddleware,
};
