const fs = require('fs');
const path = require('path');
const { S3Client, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const stream = require('stream');

const STORAGE_PROVIDER = (process.env.STORAGE_PROVIDER || 'local').toLowerCase();

class StorageService {
  constructor() {
    if (STORAGE_PROVIDER === 's3') {
      this.client = new S3Client({
        region: process.env.AWS_REGION || 'us-east-1',
        credentials: {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID,
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        }
      });
      this.bucket = process.env.AWS_S3_BUCKET;
    }
  }

  async upload(file, key) {
    if (!file) throw new Error('No file provided to upload');

    if (STORAGE_PROVIDER === 's3') {
      const body = file.buffer || (file.path ? fs.createReadStream(file.path) : null);
      if (!body) throw new Error('No file data available for S3 upload');

      const command = new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: file.mimetype,
        Metadata: { originalName: file.originalname }
      });
      await this.client.send(command);
      return { storagePath: `s3://${this.bucket}/${key}`, provider: 's3', key };
    }

    try {
      const uploadsDir = path.resolve(path.join(__dirname, '..', '..', 'uploads'));
      fs.mkdirSync(uploadsDir, { recursive: true });

      const originalName = file.originalname || (file.name || 'upload');
      const filename = key || `${Date.now()}_${originalName.replace(/[^a-zA-Z0-9._()-]/g, '_')}`;
      const destPath = path.join(uploadsDir, filename);

      // Ensure parent directories exist
      const destDir = path.dirname(destPath);
      fs.mkdirSync(destDir, { recursive: true });

      if (file.buffer && Buffer.isBuffer(file.buffer)) {
        fs.writeFileSync(destPath, file.buffer);
      } else if (file.path) {
        try {
          fs.copyFileSync(file.path, destPath);
        } catch (e) {
          fs.renameSync(file.path, destPath);
        }
      } else {
        throw new Error('No file data available to persist');
      }

      return { storagePath: '/uploads/' + filename, provider: 'local', key: filename };
    } catch (e) {
      const err = new Error('Failed to save uploaded file');
      err.cause = e;
      throw err;
    }
  }

  async getDownloadHandle(storageInfo, options = {}) {
    if (!storageInfo) throw new Error('storageInfo required');

    if (STORAGE_PROVIDER === 's3' && storageInfo.key) {
      const expiresIn = options.expiresIn || 3600;
      const command = new GetObjectCommand({ Bucket: this.bucket, Key: storageInfo.key });
      const url = await getSignedUrl(this.client, command, { expiresIn });
      return { redirectUrl: url, expiresInSeconds: expiresIn };
    }

    if (STORAGE_PROVIDER === 's3' && storageInfo.storagePath && typeof storageInfo.storagePath === 'string' && storageInfo.storagePath.startsWith('s3://')) {
      try {
        const withoutPrefix = storageInfo.storagePath.replace('s3://', '');
        const parts = withoutPrefix.split('/');
        const bucket = parts.shift();
        const key = parts.join('/');
        const expiresIn = options.expiresIn || 3600;
        const command = new GetObjectCommand({ Bucket: bucket || this.bucket, Key: key });
        const url = await getSignedUrl(this.client, command, { expiresIn });
        return { redirectUrl: url, expiresInSeconds: expiresIn };
      } catch (e) {
        const err = new Error('Failed to build signed URL');
        err.status = 500;
        throw err;
      }
    }

    let p = storageInfo.storagePath;

    const candidateUploads = path.resolve(path.join(__dirname, '..', '..', 'uploads'));
    if (typeof p === 'string' && p.startsWith('/uploads/')) {
      const rel = p.replace(/^[\\/]+uploads[\\/]+/, '');
      p = path.join(candidateUploads, rel);
    }

    if (!fs.existsSync(p)) {
      const err = new Error('File not found');
      err.status = 404;
      throw err;
    }
    const fileStream = fs.createReadStream(p);

    try {
      const resolvedP = path.resolve(p);
      let publicPath = null;
      if (resolvedP.startsWith(candidateUploads)) {
        const rel = path.relative(candidateUploads, resolvedP).replace(/\\/g, '/');
        publicPath = '/uploads/' + rel;
      } else if (resolvedP.includes('/uploads/')) {
        const idx = resolvedP.indexOf('/uploads/');
        publicPath = resolvedP.substring(idx).replace(/\\/g, '/');
      }

      const result = { stream: fileStream };
      if (publicPath) result.publicPath = publicPath;
      return result;
    } catch (e) {
      return { stream: fileStream };
    }
  }

  async deleteFile(storagePath) {
    if (!storagePath) return;

    if (STORAGE_PROVIDER === 's3') {
      if (typeof storagePath === 'string' && storagePath.startsWith('s3://')) {
        const withoutPrefix = storagePath.replace('s3://', '');
        const parts = withoutPrefix.split('/');
        const bucket = parts.shift();
        const key = parts.join('/');
        const { DeleteObjectCommand } = require('@aws-sdk/client-s3');
        const command = new DeleteObjectCommand({ Bucket: bucket || this.bucket, Key: key });
        await this.client.send(command);
      } else if (typeof storagePath === 'object' && storagePath.key) {
        const { DeleteObjectCommand } = require('@aws-sdk/client-s3');
        const command = new DeleteObjectCommand({ Bucket: this.bucket, Key: storagePath.key });
        await this.client.send(command);
      }
      return;
    }

    // Local deletion
    try {
      const uploadsDir = path.resolve(path.join(__dirname, '..', '..', 'uploads'));
      let filePath;
      if (typeof storagePath === 'string' && storagePath.startsWith('/uploads/')) {
        const rel = storagePath.replace(/^[\\/]+uploads[\\/]+/, '');
        filePath = path.join(uploadsDir, rel);
      } else if (typeof storagePath === 'string') {
        filePath = path.resolve(storagePath);
      } else {
        return;
      }

      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        // Optionally remove empty directories
        let dir = path.dirname(filePath);
        while (dir !== uploadsDir && dir !== path.dirname(dir)) {
          try {
            if (fs.readdirSync(dir).length === 0) {
              fs.rmdirSync(dir);
              dir = path.dirname(dir);
            } else {
              break;
            }
          } catch (e) {
            break;
          }
        }
      }
    } catch (e) {
      // Log but don't throw
      console.warn('Failed to delete local file:', e.message);
    }
  }
}

module.exports = new StorageService();
