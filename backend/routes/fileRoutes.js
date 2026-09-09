const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, QueryCommand, DeleteCommand, GetCommand } = require('@aws-sdk/lib-dynamodb');
const authMiddleware = require('../middleware/auth');
const multer = require('multer');

// Setup S3
const s3 = new S3Client({ region: process.env.AWS_REGION });

// Setup DynamoDB
const client = new DynamoDBClient({ region: process.env.AWS_REGION });
const db = DynamoDBDocumentClient.from(client);

// Multer - store file in memory before uploading to S3
const upload = multer({ storage: multer.memoryStorage() });

// ── UPLOAD FILE ───────────────────────────────
router.post('/upload', authMiddleware, upload.single('file'), async (req, res) => {
  try {
    const { userId, name } = req.user;
    const file = req.file;

    if (!file)
      return res.status(400).json({ error: "No file provided" });

    const fileId = uuidv4();
    const s3Key = `${userId}/${fileId}_${file.originalname}`;

    // Upload to S3
    await s3.send(new PutObjectCommand({
      Bucket: process.env.BUCKET_NAME,
      Key: s3Key,
      Body: file.buffer,
      ContentType: file.mimetype
    }));

    // Save metadata to DynamoDB
    await db.send(new PutCommand({
      TableName: 'nimbus-files',
      Item: {
        userId,
        fileId,
        fileName: file.originalname,
        fileSize: file.size,
        fileType: file.mimetype,
        s3Key,
        uploadedAt: new Date().toISOString(),
        isTrashed: false
      }
    }));

    res.status(201).json({
      message: "File uploaded successfully!",
      file: {
        fileId,
        fileName: file.originalname,
        fileSize: file.size,
        fileType: file.mimetype,
        uploadedAt: new Date().toISOString()
      }
    });

  } catch (err) {
    console.error("Upload error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ── GET ALL FILES ─────────────────────────────
router.get('/files', authMiddleware, async (req, res) => {
  try {
    const { userId } = req.user;

    const result = await db.send(new QueryCommand({
      TableName: 'nimbus-files',
      KeyConditionExpression: 'userId = :userId',
      FilterExpression: 'isTrashed = :false',
      ExpressionAttributeValues: {
        ':userId': userId,
        ':false': false
      }
    }));

    res.json({ files: result.Items });

  } catch (err) {
    console.error("Get files error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ── DOWNLOAD FILE (get signed URL) ────────────
router.get('/download/:fileId', authMiddleware, async (req, res) => {
  try {
    const { userId } = req.user;
    const { fileId } = req.params;

    // Get file metadata from DynamoDB
    const result = await db.send(new GetCommand({
      TableName: 'nimbus-files',
      Key: { userId, fileId }
    }));

    if (!result.Item)
      return res.status(404).json({ error: "File not found" });

    // Generate signed URL (valid for 1 hour)
    const url = await getSignedUrl(s3, new GetObjectCommand({
      Bucket: process.env.BUCKET_NAME,
      Key: result.Item.s3Key
    }), { expiresIn: 3600 });

    res.json({ downloadUrl: url });

  } catch (err) {
    console.error("Download error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE FILE ───────────────────────────────
router.delete('/delete/:fileId', authMiddleware, async (req, res) => {
  try {
    const { userId } = req.user;
    const { fileId } = req.params;

    // Get file metadata first
    const result = await db.send(new GetCommand({
      TableName: 'nimbus-files',
      Key: { userId, fileId }
    }));

    if (!result.Item)
      return res.status(404).json({ error: "File not found" });

    // Delete from S3
    await s3.send(new DeleteObjectCommand({
      Bucket: process.env.BUCKET_NAME,
      Key: result.Item.s3Key
    }));

    // Delete from DynamoDB
    await db.send(new DeleteCommand({
      TableName: 'nimbus-files',
      Key: { userId, fileId }
    }));

    res.json({ message: "File deleted successfully!" });

  } catch (err) {
    console.error("Delete error:", err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
