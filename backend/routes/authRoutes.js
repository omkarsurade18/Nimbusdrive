const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, QueryCommand, GetCommand } = require('@aws-sdk/lib-dynamodb');

// Setup DynamoDB
const client = new DynamoDBClient({ region: process.env.AWS_REGION });
const db = DynamoDBDocumentClient.from(client);

// ── SIGNUP ────────────────────────────────────
router.post('/signup', async (req, res) => {
  const { name, email, password } = req.body;

  if (!name || !email || !password)
    return res.status(400).json({ error: "Name, email and password are required" });

  if (password.length < 6)
    return res.status(400).json({ error: "Password must be at least 6 characters" });

  try {
    const existing = await db.send(new QueryCommand({
      TableName: 'nimbus-users',
      IndexName: 'email-index',
      KeyConditionExpression: 'email = :email',
      ExpressionAttributeValues: { ':email': email.toLowerCase() }
    }));

    if (existing.Items && existing.Items.length > 0)
      return res.status(400).json({ error: "Email already registered. Please login." });

    const hashedPassword = await bcrypt.hash(password, 12);
    const userId = uuidv4();

    await db.send(new PutCommand({
      TableName: 'nimbus-users',
      Item: {
        userId,
        email: email.toLowerCase(),
        name,
        password: hashedPassword,
        createdAt: new Date().toISOString(),
        storageUsed: 0
      }
    }));

    const token = jwt.sign(
      { userId, email: email.toLowerCase(), name },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.status(201).json({
      message: "Account created successfully!",
      token,
      user: { userId, name, email: email.toLowerCase() }
    });

  } catch (err) {
    console.error("Signup error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ── LOGIN ─────────────────────────────────────
router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password)
    return res.status(400).json({ error: "Email and password are required" });

  try {
    const result = await db.send(new QueryCommand({
      TableName: 'nimbus-users',
      IndexName: 'email-index',
      KeyConditionExpression: 'email = :email',
      ExpressionAttributeValues: { ':email': email.toLowerCase() }
    }));

    if (!result.Items || result.Items.length === 0)
      return res.status(400).json({ error: "No account found with this email." });

    const user = result.Items[0];

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch)
      return res.status(400).json({ error: "Wrong password. Try again." });

    const token = jwt.sign(
      { userId: user.userId, email: user.email, name: user.name },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      message: "Login successful!",
      token,
      user: { userId: user.userId, name: user.name, email: user.email }
    });

  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;