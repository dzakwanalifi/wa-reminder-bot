const winston = require('winston');

// Define log format
const logFormat = winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
);

// Create logger instance
const logger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: logFormat,
    transports: [
        // Write all logs to console
        new winston.transports.Console(),
        // Write all logs with level 'error' and below to 'error.log'
        new winston.transports.File({ 
            filename: 'logs/error.log', 
            level: 'error',
            dirname: 'logs' 
        }),
        // Write all logs to 'combined.log'
        new winston.transports.File({ 
            filename: 'logs/combined.log',
            dirname: 'logs'
        })
    ]
});

// Create log directory if it doesn't exist
const fs = require('fs');
const path = require('path');
const logDir = path.join(__dirname, '..', 'logs');
if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir);
}

module.exports = logger;