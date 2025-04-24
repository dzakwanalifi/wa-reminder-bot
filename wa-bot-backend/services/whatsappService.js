const fetch = require('node-fetch');

// Bridge API URL from environment
const BRIDGE_API_URL = process.env.BRIDGE_API_URL;

/**
 * Send a WhatsApp message via the Bridge API
 * @param {string} userId - The recipient's WhatsApp ID
 * @param {string} message - The message to send
 * @returns {Promise<boolean>} Success status of the message send
 */
async function sendWhatsAppMessage(userId, message) {
    if (!BRIDGE_API_URL) {
        console.error("Error: BRIDGE_API_URL is not configured.");
        return false;
    }

    console.log(`Sending message to ${userId} via Bridge: "${message}"`);
    try {
        const response = await fetch(`${BRIDGE_API_URL}/send`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId, message })
        });

        if (!response.ok) {
            const errorBody = await response.text();
            console.error(`Bridge API Error (${response.status}): ${errorBody}`);
            return false;
        }

        console.log("Message sent successfully via Bridge.");
        return true;
    } catch (error) {
        console.error("Error calling Bridge API:", error);
        return false;
    }
}

module.exports = {
    sendWhatsAppMessage
};