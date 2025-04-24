const { GoogleGenerativeAI, Type } = require('@google/generative-ai');

// Gemini Config
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_API_KEY) {
    console.error("Error: GEMINI_API_KEY is not set in environment variables.");
    process.exit(1);
}

const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const geminiModel = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

// Define the expected JSON response schema from Gemini
const GEMINI_RESPONSE_SCHEMA = {
    type: Type.OBJECT,
    properties: {
        'intent': {
            type: Type.STRING,
            description: "The user's intent (ADD_REMINDER, LIST_REMINDERS, DELETE_REMINDER, EDIT_REMINDER, UNKNOWN)",
            enum: [ // Explicitly list possible intents
                "ADD_REMINDER",
                "LIST_REMINDERS",
                "DELETE_REMINDER",
                "EDIT_REMINDER",
                "UNKNOWN"
            ]
        },
        'data': {
            type: Type.OBJECT,
            description: "Extracted data based on intent. Empty object for LIST_REMINDERS and UNKNOWN.",
            nullable: true, // Allow data to be null or empty object
            properties: {
                'task': {
                    type: Type.STRING,
                    description: "The description of the task for ADD_REMINDER or EDIT_REMINDER.",
                    nullable: true // Task might not be present for delete/list/unknown
                },
                'time': {
                    type: Type.STRING,
                    description: "The time string (natural language or ISO 8601 attempt) for ADD_REMINDER or EDIT_REMINDER's updates.",
                    nullable: true // Time might not be present
                },
                'target': {
                    type: Type.STRING,
                    description: "Keywords identifying the reminder to DELETE or EDIT.",
                    nullable: true // Target only relevant for delete/edit
                },
                'updates': {
                    type: Type.OBJECT,
                    description: "Object containing new task and/or time for EDIT_REMINDER.",
                    nullable: true, // Updates only relevant for edit
                    properties: {
                        'task': { type: Type.STRING, description: "New task description.", nullable: true },
                        'time': { type: Type.STRING, description: "New time string.", nullable: true }
                    }
                }
            },
            // Define property order for consistency
            propertyOrdering: ["task", "time", "target", "updates"]
        }
    },
    required: ['intent', 'data'] // Intent and data object are always required
};

/**
 * Analyze message with Gemini to determine intent and extract data
 * @param {string} messageText - The message to analyze
 * @returns {Object} Analysis result with intent and extracted data
 */
async function analyzeMessageWithGemini(messageText) {
    // System instruction defines the bot's role and overall task
    const systemInstruction = "You are a helpful reminder bot assistant. Analyze the user's request to determine their intent (ADD_REMINDER, LIST_REMINDERS, DELETE_REMINDER, EDIT_REMINDER, or UNKNOWN) and extract relevant data according to the provided JSON schema. Focus only on reminder-related tasks.";

    // The user's message is the main content
    const contents = [{ role: "user", parts: [{ text: messageText }] }];

    console.log(`Sending to Gemini: User request="${messageText}"`);

    try {
        // Call generateContent with structured output configuration
        const result = await geminiModel.generateContent({
            contents: contents,
            systemInstruction: { parts: [{ text: systemInstruction }] }, // Use system instruction
            generationConfig: { // Configure for JSON output
                responseMimeType: "application/json",
                responseSchema: GEMINI_RESPONSE_SCHEMA // Use the defined schema
            }
        });

        const response = result.response; // Access the response object

        // Check for safety ratings or blocks if necessary
        if (response.promptFeedback?.blockReason) {
            throw new Error(`Blocked by API: ${response.promptFeedback.blockReason}`);
        }

        // Because we requested JSON, the response text should be valid JSON
        const jsonText = response.text();
        console.log("Gemini JSON Response Text:", jsonText);

        // Parse the guaranteed JSON response
        const analysis = JSON.parse(jsonText);
        console.log("Gemini Parsed Analysis (Structured):", analysis);

        // Basic validation (schema should enforce structure, but double-check)
        if (!analysis.intent || typeof analysis.data === 'undefined') { // Check if data key exists, even if null/empty
            console.error("Unexpected JSON structure despite schema:", analysis);
            throw new Error("Invalid JSON structure received from Gemini");
        }

        return analysis; // Return the parsed object

    } catch (error) {
        console.error("Error calling or processing Gemini API:", error);
        // If error contains the raw text, log it
        if (error.message.includes("JSON.parse")) {
            // This shouldn't happen often with schema enforcement
            console.error("Failed to parse JSON response from Gemini, even with schema.");
        }
        return { intent: 'UNKNOWN', data: {}, error: `Gemini processing failed: ${error.message}` };
    }
}

module.exports = {
    analyzeMessageWithGemini
};