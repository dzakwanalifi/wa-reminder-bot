const express = require('express');
const { processWebhook } = require('../controllers/webhookController');

const router = express.Router();

// POST /webhook/whatsapp
router.post('/whatsapp', processWebhook);

module.exports = router;