const jwt = require('jsonwebtoken');

function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: "Not logged in. Please login first." });
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded; // contains userId, email, name
    next();
  } catch (err) {
    return res.status(401).json({ error: "Session expired. Please login again." });
  }
}

module.exports = authMiddleware;