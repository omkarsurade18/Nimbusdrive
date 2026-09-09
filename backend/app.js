require('dotenv').config();
const express = require('express');
const cors = require('cors');
const authRoutes = require('./routes/authRoutes');
const fileRoutes = require('./routes/fileRoutes');
const shareRoutes = require('./routes/shareRoutes');   // ← ADD THIS

const app = express();
app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
  res.send("NimbusDrive Server Running ✅");
});

app.use('/auth', authRoutes);
app.use('/', fileRoutes);
app.use('/', shareRoutes);                             // ← ADD THIS

app.listen(3000, () => {
  console.log("Server started on http://localhost:3000");
});