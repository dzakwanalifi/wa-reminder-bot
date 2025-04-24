const { getDueReminders, updateReminderStatus } = require('../services/supabaseService');
const { sendWhatsAppMessage } = require('../services/whatsappService');

/**
 * Handle reminder trigger requests
 */
async function handleReminderTrigger(req, res) {
    console.log(`[${new Date().toISOString()}] Trigger received: Checking for due reminders...`);

    let processedCount = 0;
    let errorCount = 0;

    try {
        // Get due reminders
        const dueReminders = await getDueReminders();
        console.log(`Found ${dueReminders.length} due reminders`);

        // Process each reminder
        for (const reminder of dueReminders) {
            try {
                // 1. Mark as sending
                await updateReminderStatus(reminder.id, 'sending');

                // 2. Send WhatsApp message
                const success = await sendWhatsAppMessage(
                    reminder.user_id,
                    `🔔 Pengingat: ${reminder.task_description}`
                );

                // 3. Update final status
                if (success) {
                    await updateReminderStatus(reminder.id, 'sent');
                    processedCount++;
                } else {
                    await updateReminderStatus(reminder.id, 'failed');
                    errorCount++;
                }
            } catch (reminderError) {
                console.error(`Error processing reminder ${reminder.id}:`, reminderError);
                errorCount++;
                try {
                    await updateReminderStatus(reminder.id, 'failed');
                } catch (statusError) {
                    console.error(`Failed to update status for reminder ${reminder.id}:`, statusError);
                }
            }
        }

        // Send response
        res.json({
            message: 'Trigger processed',
            total: dueReminders.length,
            processed: processedCount,
            errors: errorCount
        });

    } catch (error) {
        console.error("Error in trigger handler:", error);
        res.status(500).json({
            error: 'Internal server error',
            message: error.message
        });
    }
}

module.exports = {
    handleReminderTrigger
};