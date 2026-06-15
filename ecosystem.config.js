/**
 * PM2 ecosystem — two apps:
 *   - designprobe-api    : HTTP server (light, fast restart)
 *   - designprobe-worker : BullMQ worker (heavy, Playwright + Chromium)
 *
 * Production: pm2 start ecosystem.config.js --env production
 */
module.exports = {
  apps: [
    {
      name: "designprobe-api",
      script: "dist/backend/src/index.js",
      instances: 1,
      exec_mode: "fork",
      max_memory_restart: "800M",
      env_production: {
        NODE_ENV: "production",
        NODE_OPTIONS: "--dns-result-order=ipv4first",
      },
      out_file: "./logs/api.out.log",
      error_file: "./logs/api.err.log",
      merge_logs: true,
      time: true,
    },
    {
      name: "designprobe-worker",
      script: "dist/backend/src/worker.js",
      instances: 1,
      exec_mode: "fork",
      // Worker handles Chromium — cap before the kernel OOM-kills the whole VPS.
      max_memory_restart: "3500M",
      // Give Playwright time to drain before kill.
      kill_timeout: 30000,
      env_production: {
        NODE_ENV: "production",
        NODE_OPTIONS: "--dns-result-order=ipv4first",
        WORKER_CONCURRENCY: "2",
      },
      out_file: "./logs/worker.out.log",
      error_file: "./logs/worker.err.log",
      merge_logs: true,
      time: true,
    },
  ],
};
