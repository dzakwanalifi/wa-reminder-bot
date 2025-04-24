module.exports = {
  apps : [{
    name   : "wa-bridge",
    script : "./bridge.js", // Path relatif ke script utama
    cwd    : __dirname,      // Set working directory
    env: {
       "NODE_ENV": "production",
       "OWNER_WHATSAPP_ID": "6281225644468@c.us" // <<< PASTIKAN BENAR
       // "BRIDGE_API_PORT": "3000" // Uncomment jika perlu override port
    }
  }]
}
