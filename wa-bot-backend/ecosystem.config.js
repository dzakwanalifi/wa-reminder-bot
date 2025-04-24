require('dotenv').config(); // Load .env untuk mengambil nilainya di sini

module.exports = {
  apps : [{
    name   : "backend-app",
    script : "./server.js",   // Path ke script utama
    cwd    : __dirname,       // Set working directory ke folder ini (penting!)
    env: {
       "NODE_ENV": "production",
       // Salin semua variabel dari .env backend ke sini
       "PORT": process.env.PORT || 4000,
       "BRIDGE_API_URL": process.env.BRIDGE_API_URL,
       "SUPABASE_URL": process.env.SUPABASE_URL,
       "SUPABASE_SERVICE_KEY": process.env.SUPABASE_SERVICE_KEY,
       "GEMINI_API_KEY": process.env.GEMINI_API_KEY
    }
  }]
}