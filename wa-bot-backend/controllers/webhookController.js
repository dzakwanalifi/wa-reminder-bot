const { parseISO, format } = require('date-fns');
const { analyzeMessageWithGemini } = require('../services/geminiService');
const { sendWhatsAppMessage } = require('../services/whatsappService');
const { parseNaturalLanguageTime } = require('../utils/timeParser');
const {
    addReminder,
    getPendingReminders,
    findPendingRemindersByKeyword,
    deleteReminderById,
    updateReminderById
} = require('../services/supabaseService');

/**
 * Handle DELETE_REMINDER intent
 */
async function handleDeleteReminder(userId, data) {
    const { target } = data;

    if (!target) {
        await sendWhatsAppMessage(userId, "Mau hapus pengingat yang mana nih? Kasih tau kata kuncinya ya (contoh: 'hapus pengingat meeting').");
        return;
    }

    const findResult = await findPendingRemindersByKeyword(userId, target);

    if (findResult.error && !findResult.reminders.length) {
        await sendWhatsAppMessage(userId, findResult.error);
        return;
    }

    if (findResult.reminders.length === 0) {
        await sendWhatsAppMessage(userId, `Nggak nemu pengingat aktif yang cocok sama "${target}". Coba cek daftar pengingatmu dulu?`);
        return;
    }

    if (findResult.reminders.length > 1) {
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
    const result = await deleteReminderById(reminderToDelete.id);

    if (result.success) {
        const taskDesc = reminderToDelete.task_description || '(tanpa deskripsi)';
        await sendWhatsAppMessage(userId, `Oke, pengingat untuk "${taskDesc}" telah dihapus.`);
    } else {
        await sendWhatsAppMessage(userId, "Gagal ngehapus pengingat dari database. Mungkin koneksi lagi gangguan.");
    }
}

/**
 * Handle EDIT_REMINDER intent
 */
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

    const findResult = await findPendingRemindersByKeyword(userId, target);

    if (findResult.error && !findResult.reminders.length) {
        await sendWhatsAppMessage(userId, findResult.error);
        return;
    }

    if (findResult.reminders.length === 0) {
        await sendWhatsAppMessage(userId, `Nggak nemu pengingat aktif yang cocok sama "${target}" buat diubah. Coba cek daftar pengingatmu dulu?`);
        return;
    }

    if (findResult.reminders.length > 1) {
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
    const patchData = {};
    let newTimeISO = null;

    // Prepare new data
    if (updates.task) {
        patchData.task_description = updates.task;
    }
    if (updates.time) {
        newTimeISO = parseNaturalLanguageTime(updates.time);
        if (!newTimeISO) {
            await sendWhatsAppMessage(userId, `Waduh, format waktu barunya ("${updates.time}") agak aneh nih. Perubahan dibatalkan. Coba pakai format lain ya.`);
            return;
        }
        patchData.reminder_time = newTimeISO;
    }

    if (Object.keys(patchData).length === 0) {
        await sendWhatsAppMessage(userId, "Tidak ada perubahan valid yang bisa diterapkan.");
        return;
    }

    const result = await updateReminderById(reminderToEdit.id, patchData);

    if (result.success) {
        const updatedTask = patchData.task_description || reminderToEdit.task_description;
        const finalTimeISO = patchData.reminder_time || reminderToEdit.reminder_time;
        const finalDate = parseISO(finalTimeISO);
        const formattedFinalTime = format(finalDate, "d MMMM yyyy 'jam' HH:mm");
        await sendWhatsAppMessage(userId, `Oke, pengingat untuk "${updatedTask}" sekarang diatur pada ${formattedFinalTime}.`);
    } else {
        await sendWhatsAppMessage(userId, "Gagal ngubah pengingat di database. Mungkin koneksi lagi gangguan.");
    }
}

/**
 * Process webhook request
 */
async function processWebhook(req, res) {
    const { userId, messageText } = req.body;

    console.log(`Webhook diterima dari Bridge: User=${userId}, Message="${messageText}"`);

    if (!userId || !messageText) {
        console.error("Webhook Error: userId atau messageText kosong.");
        return res.status(400).send("Bad Request: Missing userId or messageText");
    }

    // Respond quickly to the bridge to prevent timeout
    res.sendStatus(200);

    try {
        // Analyze message with Gemini
        const analysis = await analyzeMessageWithGemini(messageText);

        // Handle based on intent
        switch (analysis.intent) {
            case 'ADD_REMINDER': {
                const { task, time: timeString } = analysis.data;
                console.log(`Intent: ADD_REMINDER, Task: "${task}", Time String: "${timeString}"`);

                if (!task || !timeString) {
                    await sendWhatsAppMessage(userId, "Hmm, kayaknya deskripsi tugas atau waktunya kurang jelas deh. Coba lagi ya. Contoh: 'Ingatkan aku meeting penting besok jam 10'.");
                    break;
                }

                const reminderTimeISO = parseNaturalLanguageTime(timeString);

                if (!reminderTimeISO) {
                    await sendWhatsAppMessage(userId, `Waduh, format waktunya "${timeString}" agak aneh nih. Coba format lain, misal 'besok jam 10 pagi' atau '3 jam lagi'.`);
                    break;
                }

                const reminderData = {
                    user_id: userId,
                    task_description: task,
                    reminder_time: reminderTimeISO,
                    status: 'pending'
                };

                const result = await addReminder(reminderData);

                if (result.success) {
                    const reminderDate = parseISO(reminderTimeISO);
                    const formattedTime = format(reminderDate, "d MMMM yyyy 'jam' HH:mm");
                    await sendWhatsAppMessage(userId, `Oke, pengingat untuk "${task}" sudah diatur pada ${formattedTime}.`);
                } else {
                    await sendWhatsAppMessage(userId, "Gagal nyimpen pengingat di database nih. Mungkin koneksi lagi gangguan. Coba beberapa saat lagi ya.");
                }
                break;
            }

            case 'LIST_REMINDERS': {
                console.log("Intent: LIST_REMINDERS");
                try {
                    const reminders = await getPendingReminders(userId);

                    let replyMessage = "Pengingatmu yang belum selesai:\n";
                    if (reminders.length === 0) {
                        replyMessage = "Kamu tidak punya pengingat yang belum selesai saat ini.";
                    } else {
                        reminders.forEach((r, index) => {
                            const reminderDate = parseISO(r.reminder_time);
                            const formattedTime = format(reminderDate, "d MMM HH:mm");
                            replyMessage += `${index + 1}. ${r.task_description} (${formattedTime})\n`;
                        });
                    }

                    await sendWhatsAppMessage(userId, replyMessage.trim());
                } catch (error) {
                    await sendWhatsAppMessage(userId, "Gagal ngambil daftar pengingat dari database. Mungkin koneksi lagi gangguan.");
                }
                break;
            }

            case 'DELETE_REMINDER':
                await handleDeleteReminder(userId, analysis.data);
                break;

            case 'EDIT_REMINDER':
                await handleEditReminder(userId, analysis.data);
                break;

            case 'UNKNOWN':
            default: {
                console.log("Intent: UNKNOWN or Gemini Error");
                let errorMessage = "Waduh, aku bingung nih sama pesanmu.";
                if (analysis.error) {
                    errorMessage = `Hmm, ada masalah pas coba ngertiin pesanmu (Error: ${analysis.error}). Coba lagi ya.`;
                } else {
                    errorMessage = "Maaf, aku belum ngerti maksudnya. Coba bilang:\n- 'Ingatkan aku [tugas] [waktu]'\n- 'Lihat pengingatku'\n- 'Hapus pengingat [kata kunci]'\n- 'Ubah pengingat [kata kunci] jadi [perubahan]'";
                }
                await sendWhatsAppMessage(userId, errorMessage);
                break;
            }
        }
    } catch (error) {
        console.error("!!! Unhandled error in webhook processing:", error);
        await sendWhatsAppMessage(userId, "Waduh, ada error tak terduga nih di sistem internal. Aku udah catet masalahnya, coba lagi nanti ya.");
    }
}

module.exports = {
    processWebhook
};