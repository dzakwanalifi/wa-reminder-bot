const { GoogleGenerativeAI } = require('@google/generative-ai');

// Gemini Config
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_API_KEY) {
    console.error("Error: GEMINI_API_KEY is not set in environment variables.");
    process.exit(1);
}

const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const geminiModel = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

/**
 * Analyze message with Gemini to determine intent and extract data
 * @param {string} messageText - The message to analyze
 * @returns {Object} Analysis result with intent and extracted data
 */
async function analyzeMessageWithGemini(messageText) {
    const prompt = `
    Analyze the following user request for a reminder bot and identify the user's intent and extract relevant data.
    Possible intents are: ADD_REMINDER, LIST_REMINDERS, DELETE_REMINDER, EDIT_REMINDER, UNKNOWN.

    - For ADD_REMINDER: Extract 'task' (what to be reminded about) and 'time' (when to be reminded).
    - For LIST_REMINDERS: No specific data extraction needed beyond the intent.
    - For DELETE_REMINDER: Extract a 'target' (description keywords of the reminder to delete, e.g., "meeting", "gammafest", "yang pertama").
    - For EDIT_REMINDER: Extract a 'target' (description keywords of the reminder to edit) AND an 'updates' object containing the new 'task' and/or 'time'.
    - If the intent is unclear or doesn't fit, classify as UNKNOWN.

    Try to parse extracted 'time' values into ISO 8601 format (UTC timezone, e.g., YYYY-MM-DDTHH:MM:SSZ) if possible. If you cannot determine a precise time, return the natural language string.

    Respond ONLY with a JSON object with keys 'intent' and 'data'.
    - 'data' for ADD_REMINDER: { "task": "...", "time": "..." }
    - 'data' for LIST_REMINDERS: {}
    - 'data' for DELETE_REMINDER: { "target": "..." }
    - 'data' for EDIT_REMINDER: { "target": "...", "updates": { "task": "...", "time": "..." } } (task/time in updates are optional)
    - 'data' for UNKNOWN: {}

    User request: "${messageText}"

    JSON Response:
    `;

    try {
        const result = await geminiModel.generateContent(prompt);
        const response = await result.response;
        let text = response.text();

        console.log("Gemini Raw Response:", text);

        // Clean the response to ensure it's valid JSON
        text = text.replace(/```json/g, '').replace(/```/g, '').trim();

        // Attempt to parse the JSON
        const analysis = JSON.parse(text);
        console.log("Gemini Parsed Analysis:", analysis);

        if (!analysis.intent || !analysis.data) {
            throw new Error("Invalid JSON structure from Gemini");
        }
        return analysis;

    } catch (error) {
        console.error("Error calling Gemini API:", error);
        console.error("Gemini raw text was:", text); // Log the text that failed parsing
        return { intent: 'UNKNOWN', data: {}, error: `Gemini API or parsing failed: ${error.message}` };
    }
}

module.exports = {
    analyzeMessageWithGemini
};