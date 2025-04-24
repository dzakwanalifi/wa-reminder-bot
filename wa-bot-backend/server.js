// Load environment variables from .env file
require('dotenv').config();

// Import necessary libraries
const express = require('express');

// Import routes
const webhookRoutes = require('./routes/webhookRoutes');
const triggerRoutes = require('./routes/triggerRoutes');

// Configuration
const PORT = process.env.PORT || 4000;

// Express App Setup
const app = express();
app.use(express.json()); // Middleware to parse JSON bodies

// Root route for basic check
app.get('/', (req, res) => {
    res.send('Backend Bot Pengingat berjalan.');
});

// Routes
app.use('/webhook', webhookRoutes);
app.use('/trigger', triggerRoutes);

// Start server
app.listen(PORT, () => {
    console.log(`Server berjalan di port ${PORT}`);
});
