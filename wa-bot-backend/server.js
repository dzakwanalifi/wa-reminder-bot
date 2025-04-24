// Load environment variables from .env file
require('dotenv').config();

// Import necessary libraries
const express = require('express');
const fetch = require('node-fetch'); // Or use axios if you installed that
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { parseISO, formatISO, add, format } = require('date-fns'); // Tambahkan format di sini

// --- Configuration ---
const PORT = process.env.PORT || 4000;
const BRIDGE_API_URL = process.env.BRIDGE_API_URL; // URL of the WhatsApp Bridge API (e.g., http://localhost:3000)

// Supabase Config
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const SUPABASE_HEADERS = {
    'apikey': SUPABASE_SERVICE_KEY,
    'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
    'Content-Type': 'application/json',
    'Prefer': 'return=minimal' // Don't return the created/updated object unless needed
};

// Gemini Config
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_API_KEY) {
    console.error("Error: GEMINI_API_KEY is not set in environment variables.");
    process.exit(1); // Exit if key is missing
}
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const geminiModel = genAI.getGenerativeModel({ model: "gemini-1.5-flash" }); // Use the Flash model

// --- Helper Functions ---

// Function to send message via Bridge API
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

// Function to analyze message with Gemini
async function analyzeMessageWithGemini(messageText) {
    const prompt = `
        Analyze the following user request for a reminder bot and identify the user's intent and extract relevant data.
        Possible intents are: ADD_REMINDER, LIST_REMINDERS, UNKNOWN.
        For ADD_REMINDER, extract the 'task' (what to be reminded about) and 'time' (when to be reminded, try to resolve relative times like "besok jam 10 pagi", "5 menit lagi" into a somewhat parsable format or keep the natural language time if unsure).
        For LIST_REMINDERS, no specific data extraction is needed beyond the intent.
        If the intent is unclear or doesn't fit, classify as UNKNOWN.

        Respond ONLY with a JSON object with keys 'intent' and 'data'. 'data' should be an object containing extracted entities like 'task' and 'time' (for ADD_REMINDER) or be an empty object for other intents.

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

// Basic Time Parser (VERY limited, might need significant improvement or dedicated library like chrono-node)
// Tries to convert simple relative terms or assumes a specific format might come from Gemini.
// Returns an ISO string in UTC or null if parsing fails.
function parseNaturalLanguageTime(timeString) {
    if (!timeString) return null;
    const lowerTimeString = timeString.toLowerCase();
    const now = new Date();

    try {
        // Very simple examples - THIS NEEDS TO BE MUCH MORE ROBUST
        if (lowerTimeString.includes("besok jam")) {
            const hourMatch = lowerTimeString.match(/jam (\d{1,2})/);
            if (hourMatch) {
                const hour = parseInt(hourMatch[1], 10);
                let targetDate = add(now, { days: 1 });
                targetDate.setHours(hour, 0, 0, 0); // Set jam, menit, detik, ms
                return formatISO(targetDate); // Returns ISO string like "2024-07-16T10:00:00+07:00" (depends on server TZ)
                                            // Ideally convert to UTC before storing: targetDate.toISOString()
            }
        } else if (lowerTimeString.includes("menit lagi")) {
             const minuteMatch = lowerTimeString.match(/(\d+) menit lagi/);
             if (minuteMatch) {
                 const minutes = parseInt(minuteMatch[1], 10);
                 const targetDate = add(now, { minutes: minutes });
                 return formatISO(targetDate); // targetDate.toISOString() for UTC
             }
        }
        // Add more complex parsing rules here...
        // Or potentially try parsing directly if Gemini provides a standard-ish format
        // const parsedDate = parseISO(timeString); // Example if Gemini gave "2024-07-15T15:30:00Z"
        // if (!isNaN(parsedDate)) {
        //     return parsedDate.toISOString();
        // }

        console.warn(`Could not parse time string: "${timeString}". Needs better parsing logic.`);
        return null; // Indicate parsing failure

    } catch (error) {
        console.error(`Error parsing time string "${timeString}":`, error);
        return null;
    }
}


// --- Express App Setup ---
const app = express();
app.use(express.json()); // Middleware to parse JSON bodies

// Root route for basic check
app.get('/', (req, res) => {
    res.send('Backend Bot Pengingat berjalan.');
});

// --- Main Webhook Handler ---
app.post('/webhook/whatsapp', async (req, res) => {
    const { userId, messageText } = req.body;

    console.log(`Webhook diterima dari Bridge: User=${userId}, Message="${messageText}"`);

    if (!userId || !messageText) {
        console.error("Webhook Error: userId atau messageText kosong.");
        return res.status(400).send("Bad Request: Missing userId or messageText");
    }

    // Respond quickly to the bridge to prevent timeout
    res.sendStatus(200); // Acknowledge receipt

    // --- Process the message asynchronously ---
    try {
        // 1. Analyze message with Gemini
        const analysis = await analyzeMessageWithGemini(messageText);

        // 2. Handle based on intent
        switch (analysis.intent) {
            case 'ADD_REMINDER':
                const { task, time: timeString } = analysis.data;
                console.log(`Intent: ADD_REMINDER, Task: "${task}", Time String: "${timeString}"`);

                if (!task || !timeString) {
                    await sendWhatsAppMessage(userId, "Maaf, saya butuh deskripsi tugas dan waktunya untuk membuat pengingat.");
                    break;
                }

                // 3. Parse the time string
                const reminderTimeISO = parseNaturalLanguageTime(timeString);

                if (!reminderTimeISO) {
                    await sendWhatsAppMessage(userId, `Maaf, saya tidak mengerti format waktu "${timeString}". Coba format lain (misal: "besok jam 10 pagi").`);
                    break;
                }

                // 4. Save to Supabase
                const reminderData = {
                    user_id: userId,
                    task_description: task,
                    reminder_time: reminderTimeISO, // Store as ISO string (Supabase handles timestamptz)
                    status: 'pending'
                };

                try {
                    const response = await fetch(`${SUPABASE_URL}/rest/v1/reminders`, {
                        method: 'POST',
                        headers: SUPABASE_HEADERS,
                        body: JSON.stringify(reminderData)
                    });

                    if (!response.ok) {
                        const errorBody = await response.text();
                        throw new Error(`Supabase error (${response.status}): ${errorBody}`);
                    }

                    console.log("Reminder saved to Supabase:", reminderData);
                    // 5. Send confirmation to user
                    // Format the time nicely for confirmation - requires parsing ISO back
                    const reminderDate = parseISO(reminderTimeISO);
                    const formattedTime = format(reminderDate, "d MMMM yyyy 'jam' HH:mm"); // Example format
                    await sendWhatsAppMessage(userId, `Oke, pengingat untuk "${task}" sudah diatur pada ${formattedTime}.`);

                } catch (dbError) {
                    console.error("Error saving reminder to Supabase:", dbError);
                    await sendWhatsAppMessage(userId, "Maaf, terjadi kesalahan saat menyimpan pengingat. Coba lagi nanti.");
                }
                break;

            case 'LIST_REMINDERS':
                console.log("Intent: LIST_REMINDERS");
                try {
                    // Fetch pending reminders for this user from Supabase
                    const params = new URLSearchParams({
                        select: 'task_description,reminder_time', // Select specific columns
                        user_id: `eq.${userId}`,                 // Filter by user ID
                        status: 'eq.pending',                    // Filter by status 'pending'
                        order: 'reminder_time.asc'               // Order by reminder time
                    });
                    const response = await fetch(`${SUPABASE_URL}/rest/v1/reminders?${params.toString()}`, {
                        method: 'GET',
                        headers: SUPABASE_HEADERS
                    });

                    if (!response.ok) {
                        const errorBody = await response.text();
                        throw new Error(`Supabase error (${response.status}): ${errorBody}`);
                    }

                    const reminders = await response.json();

                    // Format the response
                    let replyMessage = "Pengingatmu yang belum selesai:\n";
                    if (reminders.length === 0) {
                        replyMessage = "Kamu tidak punya pengingat yang belum selesai saat ini.";
                    } else {
                        reminders.forEach((r, index) => {
                            const reminderDate = parseISO(r.reminder_time);
                            // Adjust format as needed, potentially show relative time too
                            const formattedTime = format(reminderDate, "d MMM HH:mm");
                            replyMessage += `${index + 1}. ${r.task_description} (${formattedTime})\n`;
                        });
                    }

                    await sendWhatsAppMessage(userId, replyMessage.trim());

                } catch (dbError) {
                    console.error("Error fetching reminders from Supabase:", dbError);
                    await sendWhatsAppMessage(userId, "Maaf, terjadi kesalahan saat mengambil daftar pengingat.");
                }
                break;

            // TODO: Implement EDIT_REMINDER / DELETE_REMINDER if needed

            case 'UNKNOWN':
            default:
                console.log("Intent: UNKNOWN or Gemini Error");
                const errorMessage = analysis.error ? `Error: ${analysis.error}` : "Maaf, saya tidak mengerti maksudmu. Coba katakan seperti 'Ingatkan aku [tugas] [waktu]' atau 'Lihat pengingatku'.";
                await sendWhatsAppMessage(userId, errorMessage);
                break;
        }

    } catch (error) {
        // Catch any unexpected errors during processing
        console.error("!!! Unhandled error in webhook processing:", error);
        // Send a generic error message to the user
        await sendWhatsAppMessage(userId, "Waduh, ada masalah internal nih. Coba lagi beberapa saat ya.");
    }
});

// --- Trigger Endpoint for Sending Due Reminders ---
app.get('/trigger/send-reminders', async (req, res) => {
    console.log(`[${new Date().toISOString()}] Trigger received: Checking for due reminders...`);

    // 1. Get current time in UTC for comparison
    const nowUTC = new Date().toISOString();

    let processedCount = 0;
    let errorCount = 0;

    try {
        // 2. Fetch pending reminders due now or earlier from Supabase
        const params = new URLSearchParams({
            select: 'id,user_id,task_description', // Get necessary fields including ID
            status: 'eq.pending',               // Must be pending
            reminder_time: `lte.${nowUTC}`      // Reminder time is less than or equal to now (UTC)
        });

        console.log(`Querying Supabase: ${SUPABASE_URL}/rest/v1/reminders?${params.toString()}`);

        const fetchResponse = await fetch(`${SUPABASE_URL}/rest/v1/reminders?${params.toString()}`, {
            method: 'GET',
            headers: SUPABASE_HEADERS
        });

        if (!fetchResponse.ok) {
            const errorBody = await fetchResponse.text();
            throw new Error(`Supabase fetch error (${fetchResponse.status}): ${errorBody}`);
        }

        const dueReminders = await fetchResponse.json();
        console.log(`Found ${dueReminders.length} due reminders.`);

        if (dueReminders.length === 0) {
            return res.status(200).send('OK: No due reminders found.');
        }

        // 3. Process each due reminder
        for (const reminder of dueReminders) {
            console.log(`Processing reminder ID: ${reminder.id} for user: ${reminder.user_id}`);
            let currentStatus = 'sending'; // Default next status if sending succeeds

            try {
                // 3a. (Recommended) Update status to 'sending' to prevent double processing
                const updateSendingResponse = await fetch(`${SUPABASE_URL}/rest/v1/reminders?id=eq.${reminder.id}`, {
                    method: 'PATCH',
                    headers: SUPABASE_HEADERS,
                    body: JSON.stringify({ status: 'sending' })
                });

                if (!updateSendingResponse.ok) {
                    // Log error but try to continue sending, maybe status update fails but send succeeds? Risky.
                    console.error(`Failed to update reminder ${reminder.id} status to 'sending'. Status: ${updateSendingResponse.status}`);
                    // Decide if you want to stop processing this reminder here or proceed cautiously
                    // For now, we proceed but log the error.
                }

                // 3b. Send reminder message via Bridge
                const messageToSend = `🔔 Pengingat: ${reminder.task_description}`;
                const sendSuccess = await sendWhatsAppMessage(reminder.user_id, messageToSend);

                // 3c. Update status based on send result
                if (sendSuccess) {
                    console.log(`Successfully sent reminder ID: ${reminder.id}`);
                    currentStatus = 'sent';
                    processedCount++;
                } else {
                    console.error(`Failed to send reminder ID: ${reminder.id} via Bridge.`);
                    currentStatus = 'failed'; // Mark as failed if Bridge communication failed
                    errorCount++;
                }

            } catch (processingError) {
                // Catch errors during the update/send process for a single reminder
                console.error(`Error processing reminder ID ${reminder.id}:`, processingError);
                currentStatus = 'failed'; // Mark as failed if any error occurred during processing
                errorCount++;
            } finally {
                // 3d. (Important) Update status to 'sent' or 'failed' in Supabase
                try {
                    const finalUpdateResponse = await fetch(`${SUPABASE_URL}/rest/v1/reminders?id=eq.${reminder.id}`, {
                        method: 'PATCH',
                        headers: SUPABASE_HEADERS,
                        body: JSON.stringify({ status: currentStatus })
                    });

                    if (!finalUpdateResponse.ok) {
                        console.error(`Failed to update reminder ${reminder.id} final status to '${currentStatus}'. Status: ${finalUpdateResponse.status}`);
                        // Log this failure, as the reminder might get stuck in 'sending' or remain 'pending' erroneously
                        errorCount++; // Increment error count if final update fails too
                    } else {
                         console.log(`Updated reminder ${reminder.id} status to '${currentStatus}'.`);
                    }
                } catch (finalUpdateError) {
                     console.error(`Critical Error updating final status for reminder ID ${reminder.id}:`, finalUpdateError);
                     errorCount++; // Critical error during final update
                }
            }
        } // End of loop through reminders

        // 4. Send final response to Cron Job
        res.status(200).send(`OK: Processed ${processedCount} reminders successfully, ${errorCount} errors.`);

    } catch (error) {
        // Catch errors during initial fetch or other top-level issues
        console.error("!!! Error in /trigger/send-reminders handler:", error);
        res.status(500).send(`Error: ${error.message}`);
    }
});

// --- Start Server ---
app.listen(PORT, () => {
    console.log(`Server backend berjalan di http://localhost:${PORT}`);
    if (!BRIDGE_API_URL || !SUPABASE_URL || !SUPABASE_SERVICE_KEY || !GEMINI_API_KEY) {
         console.warn("PERINGATAN: Satu atau lebih environment variables (BRIDGE_API_URL, SUPABASE_URL, SUPABASE_SERVICE_KEY, GEMINI_API_KEY) belum diatur!");
    }
});
