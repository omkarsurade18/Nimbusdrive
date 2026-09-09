const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, PutCommand } = require('@aws-sdk/lib-dynamodb');
const authMiddleware = require('../middleware/auth');

const s3 = new S3Client({ region: process.env.AWS_REGION });
const db = DynamoDBDocumentClient.from(new DynamoDBClient({ region: process.env.AWS_REGION }));

// ── CREATE SHARE BUNDLE (owner calls this, auth required) ─────────────────────
// Accepts one or more fileIds, stores a bundle in nimbus-shares table,
// returns a shareable URL pointing to the landing page.
router.post('/share/bundle', authMiddleware, async (req, res) => {
  try {
    const { userId } = req.user;
    const { fileIds } = req.body; // array of fileId strings

    if (!fileIds || !Array.isArray(fileIds) || fileIds.length === 0)
      return res.status(400).json({ error: 'No files specified' });

    // Fetch metadata for every requested file (must belong to this user)
    const files = [];
    for (const fileId of fileIds) {
      const result = await db.send(new GetCommand({
        TableName: 'nimbus-files',
        Key: { userId, fileId }
      }));
      if (result.Item && !result.Item.isTrashed) {
        files.push({
          fileId:   result.Item.fileId,
          fileName: result.Item.fileName,
          fileSize: result.Item.fileSize,
          fileType: result.Item.fileType,
          s3Key:    result.Item.s3Key
        });
      }
    }

    if (files.length === 0)
      return res.status(404).json({ error: 'No valid files found' });

    const shareId  = uuidv4();
    const expiresIn = 60 * 60 * 24; // 24 hours
    const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

    // Store the bundle (no pre-signed URLs here — generate them fresh on demand)
    await db.send(new PutCommand({
      TableName: 'nimbus-shares',
      Item: {
        shareId,
        userId,
        files,
        createdAt: new Date().toISOString(),
        expiresAt
      }
    }));

    // IMPORTANT: replace the Netlify URL below with YOUR actual frontend URL
    const FRONTEND_URL = process.env.FRONTEND_URL || 'https://amazing-kangaroo-ec32f7.netlify.app';

    res.json({
      shareId,
      shareUrl:  `${FRONTEND_URL}/?share=${shareId}`,
      expiresIn: '24 hours',
      fileCount: files.length
    });

  } catch (err) {
    console.error('Share bundle error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── GET BUNDLE (anyone with the link calls this, NO auth required) ─────────────
// Returns fresh pre-signed download URLs for every file in the bundle.
router.get('/share/bundle/:shareId', async (req, res) => {
  try {
    const { shareId } = req.params;

    const result = await db.send(new GetCommand({
      TableName: 'nimbus-shares',
      Key: { shareId }
    }));

    if (!result.Item)
      return res.status(404).json({ error: 'Share link not found' });

    if (new Date(result.Item.expiresAt) < new Date())
      return res.status(410).json({ error: 'This share link has expired' });

    // Generate fresh 1-hour pre-signed download URLs
    const files = await Promise.all(result.Item.files.map(async (f) => {
      const downloadUrl = await getSignedUrl(
        s3,
        new GetObjectCommand({
          Bucket: process.env.BUCKET_NAME,
          Key:    f.s3Key,
          ResponseContentDisposition: `attachment; filename="${f.fileName}"`
        }),
        { expiresIn: 3600 }
      );
      return {
        fileId:      f.fileId,
        fileName:    f.fileName,
        fileSize:    f.fileSize,
        fileType:    f.fileType,
        downloadUrl
      };
    }));

    res.json({
      shareId,
      files,
      fileCount:  files.length,
      expiresAt:  result.Item.expiresAt
    });

  } catch (err) {
    console.error('Get bundle error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── LEGACY: single-file share link (kept for backwards compatibility) ──────────
router.get('/share/:fileId', authMiddleware, async (req, res) => {
  try {
    const { userId } = req.user;
    const { fileId }  = req.params;
    const expiresIn   = 60 * 60 * 24;

    const result = await db.send(new GetCommand({
      TableName: 'nimbus-files',
      Key: { userId, fileId }
    }));

    if (!result.Item)
      return res.status(404).json({ error: 'File not found' });

    const shareUrl = await getSignedUrl(
      s3,
      new GetObjectCommand({
        Bucket: process.env.BUCKET_NAME,
        Key:    result.Item.s3Key,
        ResponseContentDisposition: `attachment; filename="${result.Item.fileName}"`
      }),
      { expiresIn }
    );

    res.json({ shareUrl, fileName: result.Item.fileName, expiresIn: '24 hours' });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
