// ~/whatsapp-bridge/ecosystem.config.js
module.exports = {
  apps : [{
    name   : "wa-bridge",
    script : "./bridge.js", // Path relatif ke script utama
    env: {
       "NODE_ENV": "production", // Opsional, tapi bagus untuk production
       "OWNER_WHATSAPP_ID": "6281225644468@c.us" // <<< GANTI DENGAN NOMOR WA MU
       // Tambahkan variabel .env lain jika perlu oleh bridge.js
       // "BRIDGE_API_PORT": "3000" // Contoh jika ingin set port
    }
  }]
}
