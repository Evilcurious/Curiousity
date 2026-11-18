import { loadEnvFile } from 'node:process';

// Direct Node launches (for example from systemd or PM2) use the same .env as
// npm start. Load it before modules read configuration; exported env wins.
try { loadEnvFile(); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
