module.exports = {
  apps: [
    {
      name: 'demonic-flac-studio',
      script: './src/server.js',
      cwd: __dirname,

      // IMPORTANT: session state (uploaded tracks, tag edits) lives in the
      // process's memory (see src/services/sessionManager.js — no database
      // by design). Do NOT run this app in PM2 "cluster" mode or with more
      // than one instance: separate workers would each hold a different,
      // inconsistent view of the same session.
      instances: 1,
      exec_mode: 'fork',

      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      min_uptime: '10s',
      max_restarts: 10,
      restart_delay: 3000,

      env: {
        NODE_ENV: 'production',
        PORT: 3008,
        HOST: '127.0.0.1',
      },

      error_file: './logs/pm2-error.log',
      out_file: './logs/pm2-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
    },
  ],
};
