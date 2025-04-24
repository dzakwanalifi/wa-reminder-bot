const { GoogleGenAI, Type } = require('@google/genai');

// Gemini Config
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_API_KEY) {
    console.error("Error: GEMINI_API_KEY is not set in environment variables.");
    process.exit(1);
}

const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

// Define the expected JSON response schema from Gemini
const GEMINI_RESPONSE_SCHEMA = {
    type: Type.OBJECT,
    properties: {
        'intent': {
            type: Type.STRING,
            description: "The user's intent",
            enum: [
                "ADD_REMINDER",
                "LIST_REMINDERS",
                "DELETE_REMINDER",
                "EDIT_REMINDER",
                "UNKNOWN"
            ],
            nullable: false
        },
        'data': {
            type: Type.OBJECT,
            description: "Extracted data based on intent",
            properties: {
                'task': { type: Type.STRING, nullable: true },
                'time': { type: Type.STRING, nullable: true },
                'target': { type: Type.STRING, nullable: true },
                'updates': {
                    type: Type.OBJECT,
                    properties: {
                        'task': { type: Type.STRING, nullable: true },
                        'time': { type: Type.STRING, nullable: true }
                    },
                    nullable: true
                }
            },
            propertyOrdering: ["task", "time", "target", "updates"],
            nullable: true
        }
    },
    required: ['intent', 'data']
};

/**
 * Analyze message with Gemini to determine intent and extract data
 * @param {string} messageText - The message to analyze
 * @returns {Object} Analysis result with intent and extracted data
 */
async function analyzeMessageWithGemini(messageText) {
    // Ensure schema was properly defined
    if (!GEMINI_RESPONSE_SCHEMA) {
        console.error("CRITICAL: GEMINI_RESPONSE_SCHEMA was not defined!");
        return {
            intent: 'UNKNOWN',
            data: {},
            error: 'Internal configuration error: Schema missing.'
        };
    }

    // System instruction defines the bot's role and overall task
    const systemInstruction = "You are a helpful reminder bot assistant. Analyze the user's request to determine their intent (ADD_REMINDER, LIST_REMINDERS, DELETE_REMINDER, EDIT_REMINDER, or UNKNOWN) and extract relevant data according to the provided JSON schema. Focus only on reminder-related tasks.";

    // The user's message is the main content
    const contents = [{ role: "user", parts: [{ text: messageText }] }];

    console.log(`Sending to Gemini: User request="${messageText}"`);

    try {
        // Call generateContent with structured output configuration
        const response = await ai.models.generateContent({
            model: 'gemini-2.0-flash',
            contents: contents,
            systemInstruction: { parts: [{ text: systemInstruction }] },
            config: {
                responseMimeType: 'application/json',
                responseSchema: GEMINI_RESPONSE_SCHEMA
            }
        });

        const jsonText = response.text();
        console.log("Gemini Response:", jsonText);
        return JSON.parse(jsonText);
    } catch (error) {
        console.error("Error processing Gemini request:", error);
        return { intent: 'UNKNOWN', data: {}, error: error.message };
    }
}

module.exports = {
    analyzeMessageWithGemini
};