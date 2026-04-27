module.exports = {
  apps: [{
    name: 'video-server',
    script: './dist/app.js',
    instances: 1,
    exec_mode: 'fork',  // 不用cluster，因为有SSE流式响应
    env: {
      NODE_ENV: 'production',
    },
    error_file: './logs/error.log',
    out_file: './logs/out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    max_memory_restart: '1G',
    restart_delay: 4000,
    watch: false,
    max_restarts: 10,
    min_uptime: '10s',
  }]
};
