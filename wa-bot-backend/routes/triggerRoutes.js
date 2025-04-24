const express = require('express');
const { handleReminderTrigger } = require('../controllers/triggerController');

const router = express.Router();

// GET /trigger/send-reminders
router.get('/send-reminders', handleReminderTrigger);

module.exports = router;