const fetch = require('node-fetch');

// Supabase Config
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const SUPABASE_HEADERS = {
    'apikey': SUPABASE_SERVICE_KEY,
    'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
    'Content-Type': 'application/json',
    'Prefer': 'return=minimal'
};

/**
 * Add a new reminder to the database
 * @param {Object} reminderData - The reminder data to add
 * @returns {Promise<Object>} Result of the operation
 */
async function addReminder(reminderData) {
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
        return { success: true };
    } catch (error) {
        console.error("Error saving reminder to Supabase:", error);
        return { success: false, error: error.message };
    }
}

/**
 * Get pending reminders for a user
 * @param {string} userId - The user's ID
 * @returns {Promise<Array>} List of pending reminders
 */
async function getPendingReminders(userId) {
    try {
        const params = new URLSearchParams({
            select: 'task_description,reminder_time',
            user_id: `eq.${userId}`,
            status: 'eq.pending',
            order: 'reminder_time.asc'
        });

        const response = await fetch(`${SUPABASE_URL}/rest/v1/reminders?${params.toString()}`, {
            method: 'GET',
            headers: SUPABASE_HEADERS
        });

        if (!response.ok) {
            const errorBody = await response.text();
            throw new Error(`Supabase error (${response.status}): ${errorBody}`);
        }

        return await response.json();
    } catch (error) {
        console.error("Error fetching reminders from Supabase:", error);
        throw error;
    }
}

/**
 * Find pending reminders by keyword
 * @param {string} userId - The user's ID
 * @param {string} targetDescription - The search keyword
 * @returns {Promise<Object>} Search results
 */
async function findPendingRemindersByKeyword(userId, targetDescription) {
    if (!targetDescription) return { error: 'Deskripsi target tidak diberikan.', reminders: [] };

    console.log(`Finding targets for user ${userId} matching "${targetDescription}"`);
    const searchPattern = `%${targetDescription.replace(/ /g, '%')}%`;

    const params = new URLSearchParams({
        select: 'id,task_description,reminder_time',
        user_id: `eq.${userId}`,
        status: 'eq.pending',
        task_description: `ilike.${searchPattern}`,
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
    } catch (error) {
        console.error("Error finding reminder targets:", error);
        return { error: 'Gagal saat nyari pengingat di database, mungkin ada gangguan koneksi.', reminders: [] };
    }
}

/**
 * Delete a reminder by ID
 * @param {string} id - The reminder ID
 * @returns {Promise<Object>} Result of the operation
 */
async function deleteReminderById(id) {
    try {
        const response = await fetch(`${SUPABASE_URL}/rest/v1/reminders?id=eq.${id}`, {
            method: 'DELETE',
            headers: SUPABASE_HEADERS
        });

        if (!response.ok) {
            const errorBody = await response.text();
            throw new Error(`Supabase delete error (${response.status}): ${errorBody}`);
        }

        return { success: true };
    } catch (error) {
        console.error("Error deleting reminder:", error);
        return { success: false, error: error.message };
    }
}

/**
 * Update a reminder by ID
 * @param {string} id - The reminder ID
 * @param {Object} patchData - The data to update
 * @returns {Promise<Object>} Result of the operation
 */
async function updateReminderById(id, patchData) {
    try {
        const response = await fetch(`${SUPABASE_URL}/rest/v1/reminders?id=eq.${id}`, {
            method: 'PATCH',
            headers: SUPABASE_HEADERS,
            body: JSON.stringify(patchData)
        });

        if (!response.ok) {
            const errorBody = await response.text();
            throw new Error(`Supabase patch error (${response.status}): ${errorBody}`);
        }

        return { success: true };
    } catch (error) {
        console.error("Error updating reminder:", error);
        return { success: false, error: error.message };
    }
}

/**
 * Get due reminders
 * @returns {Promise<Array>} List of due reminders
 */
async function getDueReminders() {
    try {
        const nowUTC = new Date().toISOString();
        const params = new URLSearchParams({
            select: 'id,user_id,task_description',
            status: 'eq.pending',
            reminder_time: `lte.${nowUTC}`
        });

        const response = await fetch(`${SUPABASE_URL}/rest/v1/reminders?${params.toString()}`, {
            method: 'GET',
            headers: SUPABASE_HEADERS
        });

        if (!response.ok) {
            const errorBody = await response.text();
            throw new Error(`Supabase error (${response.status}): ${errorBody}`);
        }

        return await response.json();
    } catch (error) {
        console.error("Error fetching due reminders:", error);
        throw error;
    }
}

/**
 * Update reminder status
 * @param {string} id - The reminder ID
 * @param {string} status - The new status ('sending'|'sent'|'failed')
 * @returns {Promise<Object>} Result of the operation
 */
async function updateReminderStatus(id, status) {
    return updateReminderById(id, { status });
}

module.exports = {
    addReminder,
    getPendingReminders,
    findPendingRemindersByKeyword,
    deleteReminderById,
    updateReminderById,
    getDueReminders,
    updateReminderStatus
};