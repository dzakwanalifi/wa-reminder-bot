// Import library yang dibutuhkan
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const express = require('express'); // Dibutuhkan untuk endpoint /send nanti
const fetch = require('node-fetch'); // Dibutuhkan untuk POST ke backend nanti
require('dotenv').config();

console.log('Memulai WhatsApp Bridge...');

// Inisialisasi WhatsApp Client
const client = new Client({
    authStrategy: new LocalAuth(), // Gunakan LocalAuth untuk menyimpan sesi
    puppeteer: {
        headless: true, // Jalankan browser di background
        // Argumen penting untuk berjalan di server Linux tanpa GUI
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage', // Tambahan untuk stabilitas di beberapa sistem
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--single-process', // Bisa membantu mengurangi memory usage
            '--disable-gpu'
        ],
    }
});

// Event: Menampilkan QR Code untuk login
client.on('qr', (qr) => {
    console.log('QR Code diterima, scan dengan WhatsApp di ponsel Anda:');
    qrcode.generate(qr, { small: true }); // Tampilkan QR di terminal
});

// Event: Berhasil terautentikasi dan siap
client.on('ready', () => {
    console.log('WhatsApp Client Siap!');
    // Di sini kita bisa menambahkan logika untuk memulai server API Bridge
});

// Event: Terputus dari WhatsApp
client.on('disconnected', (reason) => {
    console.log('WhatsApp Client terputus:', reason);
    // Mungkin perlu logika restart atau notifikasi di sini
});

// Event: Gagal Autentikasi
client.on('auth_failure', msg => {
    console.error('Autentikasi Gagal:', msg);
    console.error('Hapus folder .wwebjs_auth dan coba scan QR lagi.');
    // Mungkin perlu keluar dari proses atau mencoba inisialisasi ulang
});

// Mulai proses koneksi ke WhatsApp
console.log('Menginisialisasi WhatsApp Client...');
client.initialize();

// --- Tambahkan listener pesan dan server API di sini ---

// Event: Pesan baru diterima
client.on('message', async msg => {
    // Dapatkan nomor pengirim (misal: 6281234567890@c.us)
    const senderId = msg.from;
    // Dapatkan isi pesan
    const messageText = msg.body;

    console.log(`Pesan diterima dari ${senderId}: "${messageText}"`);

    // --- FILTER PENTING: Hanya proses pesan dari OWNER ---
    // Ganti dengan nomor WhatsApp Anda dalam format 'NOMOR@c.us'
    // Cara terbaik adalah menggunakan environment variable

	const ownerWhatsappId = process.env.OWNER_WHATSAPP_ID; // Ambil dari .env

	if (!ownerWhatsappId) {
	    console.error("FATAL ERROR: OWNER_WHATSAPP_ID is not set in environment variables!");
	    // Mungkin hentikan proses atau cegah pemrosesan pesan
	    return;
	}

	if (senderId !== ownerWhatsappId) {
	     console.log(`Pesan dari ${senderId} diabaikan (bukan owner).`);
	     return; // Hentikan pemrosesan jika bukan dari owner
	 }

    if (senderId !== ownerWhatsappId) {
        console.log(`Pesan dari ${senderId} diabaikan (bukan owner).`);
        return; // Hentikan pemrosesan jika bukan dari owner
    }
    // --- AKHIR FILTER ---

    // URL endpoint webhook di backend kita
    const backendWebhookUrl = 'http://localhost:4000/webhook/whatsapp';

    // Siapkan data untuk dikirim ke backend
    const payload = {
        userId: senderId,
        messageText: messageText
    };

    // Kirim data ke backend menggunakan node-fetch
    try {
        console.log(`Mengirim ke backend: ${JSON.stringify(payload)}`);
        const response = await fetch(backendWebhookUrl, {
            method: 'POST',
            body: JSON.stringify(payload),
            headers: { 'Content-Type': 'application/json' }
        });

        if (response.ok) {
            console.log('Berhasil mengirim data ke backend.');
        } else {
            const responseBody = await response.text(); // Coba baca body respons error
            console.error(`Gagal mengirim data ke backend. Status: ${response.status}. Respons: ${responseBody}`);
        }
    } catch (error) {
        console.error('Error saat menghubungi backend:', error);
    }
});

// --- Server API Kecil untuk Menerima Perintah Kirim dari Backend ---

const bridgeApp = express();
const BRIDGE_API_PORT = process.env.BRIDGE_API_PORT || 3000; // Port untuk API bridge

// Middleware untuk membaca body JSON dari request backend
bridgeApp.use(express.json());

// Endpoint POST /send
bridgeApp.post('/send', async (req, res) => {
    const { userId, message } = req.body; // Ambil userId dan message dari body request

    console.log(`API Bridge: Menerima permintaan kirim ke ${userId}: "${message}"`);

    if (!userId || !message) {
        console.error('API Bridge: userId atau message tidak ada dalam request.');
        return res.status(400).send({ success: false, error: 'Missing userId or message in request body' });
    }

    // Pastikan WhatsApp client sudah ready sebelum mencoba mengirim
    const state = await client.getState();
    if (state !== 'CONNECTED') {
         console.error(`API Bridge: WhatsApp client tidak siap (State: ${state}). Pesan tidak dikirim.`);
         return res.status(503).send({ success: false, error: `WhatsApp client not ready (State: ${state})`});
    }

    try {
        // Gunakan client whatsapp-web.js untuk mengirim pesan
        await client.sendMessage(userId, message);
        console.log(`API Bridge: Pesan berhasil dikirim ke ${userId}`);
        res.status(200).send({ success: true, message: 'Message sent successfully' });
    } catch (error) {
        console.error(`API Bridge: Gagal mengirim pesan ke ${userId}:`, error);
        res.status(500).send({ success: false, error: `Failed to send message: ${error.message}` });
    }
});

// Mulai server API Bridge (sebaiknya setelah client WA siap atau dalam proses inisialisasi)
// Kita bisa letakkan ini di dalam event 'ready' atau di sini langsung
// Jika diletakkan di sini, ia akan mulai mendengarkan segera.
bridgeApp.listen(BRIDGE_API_PORT, () => {
    console.log(`API Bridge berjalan dan mendengarkan di http://localhost:${BRIDGE_API_PORT}`);
});

// --- Akhir Server API Kecil ---
