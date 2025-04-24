// Load environment variables from .env file
require('dotenv').config();

// Import necessary libraries
const express = require('express');
const fetch = require('node-fetch'); // Or use axios if you installed that
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { parseISO, formatISO, add, format } = require('date-fns'); // Tambahkan format di sini
const chrono = require('chrono-node'); // Parse natural language time strings

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

// Basic Time Parser (VERY limited, might need significant improvement or dedicated library like chrono-node)
// Tries to convert simple relative terms or assumes a specific format might come from Gemini.
// Returns an ISO string in UTC or null if parsing fails.
// Updated Time Parser using chrono-node
function parseNaturalLanguageTime(timeString, referenceDate = new Date()) {
    if (!timeString) return null;
    console.log(`Attempting to parse time string with Chrono: "${timeString}"`);
    try {
        // Chrono akan coba mengurai string relatif terhadap referenceDate (waktu sekarang)
        // forwardDate: true -> penting agar "Jumat jam 5 sore" diartikan Jumat depan, bukan yg sudah lewat
        const parsedResults = chrono.parse(timeString, referenceDate, { forwardDate: true });

        // Chrono.parse mengembalikan array, ambil hasil yang paling mungkin (pertama)
        if (parsedResults && parsedResults.length > 0) {
            const parsedDate = parsedResults[0].start.date(); // Ambil objek Date dari hasil parse
            console.log(`Chrono parsed "${timeString}" to: ${parsedDate.toISOString()}`);
            // Selalu simpan dalam UTC untuk konsistensi
            return parsedDate.toISOString(); // Kembalikan format ISO 8601 UTC
        } else {
            console.warn(`Chrono could not parse time string: "${timeString}"`);
            return null; // Gagal parse
        }
    } catch (error) {
        console.error(`Error parsing time string "${timeString}" with Chrono:`, error);
        return null; // Error saat parsing
    }
}


// --- Helper Functions for Edit/Delete ---

// Helper to find potential reminder targets
async function findReminderTargets(userId, targetDescription) {
    if (!targetDescription) return { error: 'Deskripsi target tidak diberikan.', reminders: [] };

    console.log(`Finding targets for user ${userId} matching "${targetDescription}"`);
    const searchPattern = `%${targetDescription.replace(/ /g, '%')}%`; // Basic keyword matching

    const params = new URLSearchParams({
        select: 'id,task_description,reminder_time', // Get needed info
        user_id: `eq.${userId}`,
        status: 'eq.pending',
        task_description: `ilike.${searchPattern}`, // Case-insensitive partial match
        order: 'reminder_time.asc'
    });

    try {
        const response = await fetch(`${SUPABASE_URL}/rest/v1/reminders?${params.toString()}`, {
            method: 'GET',
            headers: SUPABASE_HEADERS
        });

        if (!response.ok) {
            const errorBody = await response.text();
            console.error(`Supabase find error (${response.status}): ${errorBody}`);
            return { error: 'Gagal mencari pengingat di database.', reminders: [] };
        }

        const reminders = await response.json();
        console.log(`Found ${reminders.length} potential targets.`);
        return { error: null, reminders: reminders };

    } catch (dbError) {
        console.error("Error finding reminder targets:", dbError);
        return { error: 'Gagal saat nyari pengingat di database, mungkin ada gangguan koneksi.', reminders: [] };
    }
}

// Main handler logic for DELETE_REMINDER intent
async function handleDeleteReminder(userId, data) {
    const { target } = data;

    if (!target) {
        await sendWhatsAppMessage(userId, "Mau hapus pengingat yang mana nih? Kasih tau kata kuncinya ya (contoh: 'hapus pengingat meeting').");
        return;
    }

    const findResult = await findReminderTargets(userId, target);

    if (findResult.error && !findResult.reminders.length) {
        await sendWhatsAppMessage(userId, findResult.error);
        return;
    }

    if (findResult.reminders.length === 0) {
        await sendWhatsAppMessage(userId, `Nggak nemu pengingat aktif yang cocok sama "${target}". Coba cek daftar pengingatmu dulu?`);
        return;
    }

    if (findResult.reminders.length > 1) {
        // Handle Ambiguity (Simple Version)
        let replyMessage = `Ditemukan lebih dari satu pengingat yang cocok dengan "${target}":\n`;
        findResult.reminders.forEach((r, index) => {
            const reminderDate = parseISO(r.reminder_time);
            const formattedTime = format(reminderDate, "d MMM HH:mm");
            replyMessage += `${index + 1}. ${r.task_description} (${formattedTime})\n`;
        });
        replyMessage += "\nMohon berikan deskripsi yang lebih spesifik untuk dihapus.";
        await sendWhatsAppMessage(userId, replyMessage.trim());
        return;
    }

    // Exactly one reminder found
    const reminderToDelete = findResult.reminders[0];
    console.log(`Attempting to delete reminder ID: ${reminderToDelete.id}`);

    try {
        const response = await fetch(`${SUPABASE_URL}/rest/v1/reminders?id=eq.${reminderToDelete.id}`, {
            method: 'DELETE',
            headers: SUPABASE_HEADERS
        });

        if (!response.ok) {
            const errorBody = await response.text();
            throw new Error(`Supabase delete error (${response.status}): ${errorBody}`);
        }

        console.log(`Successfully deleted reminder ID: ${reminderToDelete.id}`);
        const taskDesc = reminderToDelete.task_description || '(tanpa deskripsi)';
        await sendWhatsAppMessage(userId, `Oke, pengingat untuk "${taskDesc}" telah dihapus.`);

    } catch (dbError) {
        console.error("Error deleting reminder:", dbError);
        await sendWhatsAppMessage(userId, "Gagal ngehapus pengingat dari database. Mungkin koneksi lagi gangguan.");
    }
}

// Main handler logic for EDIT_REMINDER intent
async function handleEditReminder(userId, data) {
    const { target, updates } = data;

    if (!target) {
        await sendWhatsAppMessage(userId, "Mau ubah pengingat yang mana nih? Kasih tau kata kuncinya ya.");
        return;
    }
    if (!updates || (!updates.task && !updates.time)) {
         await sendWhatsAppMessage(userId, "Mau diubah jadi apa nih? Kasih tau detailnya ya (contoh: 'ubah jadi meeting penting' atau 'ubah waktunya jadi besok jam 2 siang').");
         return;
    }

    const findResult = await findReminderTargets(userId, target);

    if (findResult.error && !findResult.reminders.length) {
        await sendWhatsAppMessage(userId, findResult.error);
        return;
    }

    if (findResult.reminders.length === 0) {
        await sendWhatsAppMessage(userId, `Nggak nemu pengingat aktif yang cocok sama "${target}" buat diubah. Coba cek daftar pengingatmu dulu?`);
        return;
    }

    if (findResult.reminders.length > 1) {
        // Handle Ambiguity (Simple Version) - Sama seperti delete
         let replyMessage = `Ditemukan lebih dari satu pengingat yang cocok dengan "${target}":\n`;
         findResult.reminders.forEach((r, index) => {
             const reminderDate = parseISO(r.reminder_time);
             const formattedTime = format(reminderDate, "d MMM HH:mm");
             replyMessage += `${index + 1}. ${r.task_description} (${formattedTime})\n`;
         });
         replyMessage += "\nMohon berikan deskripsi yang lebih spesifik untuk diubah.";
         await sendWhatsAppMessage(userId, replyMessage.trim());
         return;
    }

    // Exactly one reminder found
    const reminderToEdit = findResult.reminders[0];
    console.log(`Attempting to edit reminder ID: ${reminderToEdit.id}`);

    const patchData = {};
    let newTimeISO = null;

    // Prepare new data
    if (updates.task) {
        patchData.task_description = updates.task;
    }
    if (updates.time) {
        // Parse the new time string
        newTimeISO = parseNaturalLanguageTime(updates.time);
        if (!newTimeISO) {
             await sendWhatsAppMessage(userId, `Waduh, format waktu barunya ("${updates.time}") agak aneh nih. Perubahan dibatalkan. Coba pakai format lain ya.`);
             return; // Stop edit if new time is invalid
        }
        patchData.reminder_time = newTimeISO;
    }

    // Check if there's anything to update
     if (Object.keys(patchData).length === 0) {
         await sendWhatsAppMessage(userId, "Tidak ada perubahan valid yang bisa diterapkan.");
         return;
     }

    try {
        console.log(`Patching reminder ID ${reminderToEdit.id} with data:`, patchData);
        const response = await fetch(`${SUPABASE_URL}/rest/v1/reminders?id=eq.${reminderToEdit.id}`, {
            method: 'PATCH',
            headers: SUPABASE_HEADERS,
            body: JSON.stringify(patchData)
        });

        if (!response.ok) {
            const errorBody = await response.text();
            throw new Error(`Supabase patch error (${response.status}): ${errorBody}`);
        }

        console.log(`Successfully updated reminder ID: ${reminderToEdit.id}`);
        // Construct confirmation message based on what was changed
        const updatedTask = patchData.task_description || reminderToEdit.task_description;
        const finalTimeISO = patchData.reminder_time || reminderToEdit.reminder_time;
        const finalDate = parseISO(finalTimeISO);
        const formattedFinalTime = format(finalDate, "d MMMM yyyy 'jam' HH:mm");
        const confirmation = `Oke, pengingat untuk "${updatedTask}" sekarang diatur pada ${formattedFinalTime}.`;

        await sendWhatsAppMessage(userId, confirmation);

    } catch (dbError) {
        console.error("Error updating reminder:", dbError);
        await sendWhatsAppMessage(userId, "Gagal ngubah pengingat di database. Mungkin koneksi lagi gangguan.");
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
                    await sendWhatsAppMessage(userId, "Hmm, kayaknya deskripsi tugas atau waktunya kurang jelas deh. Coba lagi ya. Contoh: 'Ingatkan aku meeting penting besok jam 10'.");
                    break;
                }

                // 3. Parse the time string
                const reminderTimeISO = parseNaturalLanguageTime(timeString);

                if (!reminderTimeISO) {
                    await sendWhatsAppMessage(userId, `Waduh, format waktunya "${timeString}" agak aneh nih. Coba format lain, misal 'besok jam 10 pagi' atau '3 jam lagi'.`);
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
                    await sendWhatsAppMessage(userId, "Gagal nyimpen pengingat di database nih. Mungkin koneksi lagi gangguan. Coba beberapa saat lagi ya.");
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
                    await sendWhatsAppMessage(userId, "Gagal ngambil daftar pengingat dari database. Mungkin koneksi lagi gangguan.");
                }
                break;

            // TODO: Implement EDIT_REMINDER / DELETE_REMINDER if needed

            case 'UNKNOWN':
            default:
                console.log("Intent: UNKNOWN or Gemini Error");
                let errorMessage = "Waduh, aku bingung nih sama pesanmu.";
                if (analysis.error) {
                    // Jika ada error spesifik dari Gemini
                    errorMessage = `Hmm, ada masalah pas coba ngertiin pesanmu (Error: ${analysis.error}). Coba lagi ya.`;
                } else {
                    // Jika intent tidak dikenali
                    errorMessage = "Maaf, aku belum ngerti maksudnya. Coba bilang:\n- 'Ingatkan aku [tugas] [waktu]'\n- 'Lihat pengingatku'\n- 'Hapus pengingat [kata kunci]'\n- 'Ubah pengingat [kata kunci] jadi [perubahan]'";
                }
                await sendWhatsAppMessage(userId, errorMessage);
                break;
        }

    } catch (error) {
        // Catch any unexpected errors during processing
        console.error("!!! Unhandled error in webhook processing:", error);
        // Send a generic error message to the user
        await sendWhatsAppMessage(userId, "Waduh, ada error tak terduga nih di sistem internal. Aku udah catet masalahnya, coba lagi nanti ya.");
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
