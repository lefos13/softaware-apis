/* global process, __dirname */
/*
 * PM2 runs a single forked Express process by default because this service
 * keeps local file and SQLite-backed state, and the deploy script injects the
 * production environment before startOrReload so restarts stay consistent.
 */
const path = require('node:path');

const parseInstances = (value) => {
  const parsed = Number.parseInt(String(value || '1'), 10);
  return Number.isNaN(parsed) || parsed < 1 ? 1 : parsed;
};

module.exports = {
  apps: [
    {
      name: process.env.PM2_APP_NAME || 'softaware-apis',
      cwd: __dirname,
      script: './src/server.js',
      interpreter: 'node',
      exec_mode: 'fork',
      instances: parseInstances(process.env.PM2_INSTANCES),
      autorestart: true,
      watch: false,
      max_memory_restart: process.env.PM2_MAX_MEMORY_RESTART || '500M',
      out_file: path.join(__dirname, 'logs', 'pm2-out.log'),
      error_file: path.join(__dirname, 'logs', 'pm2-error.log'),
      log_date_format: process.env.PM2_LOG_DATE_FORMAT || 'YYYY-MM-DD HH:mm:ss Z',
      env_production: {
        NODE_ENV: 'production',
      },
    },
  ],
};
