// pm2 apps for staging on server2 (run as ton07 from /opt/field-service/staging/field-service):
//   pm2 start infra/deploy/staging.ecosystem.config.cjs && pm2 save
// Secrets come from /etc/field-service/staging.env; nothing secret is in this file.
const node = '/opt/node-24/bin/node';
const envFile = '--env-file=/etc/field-service/staging.env';
const host = process.env.STAGING_HOST || '192.168.1.127';
module.exports = {
  apps: [
    { name: 'fs-staging-api', script: 'apps/api/dist/main.js', interpreter: node, node_args: envFile, max_memory_restart: '512M' },
    { name: 'fs-staging-worker', script: 'apps/api/dist/worker.js', interpreter: node, node_args: envFile, max_memory_restart: '512M' },
    { name: 'fs-staging-web', cwd: 'apps/admin', script: 'node_modules/next/dist/bin/next', args: `start -H ${host} -p 3200`, interpreter: node, max_memory_restart: '512M' },
  ],
};
