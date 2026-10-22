import { existsSync } from 'node:fs';
import { sim } from '../sim/index.ts';
import { createServer } from './app.ts';
import { loadConfig } from './config.ts';
import { consoleLogger, errorMessage } from './log.ts';

if (existsSync('.env')) process.loadEnvFile('.env');
const server = await createServer(loadConfig(process.env), sim);

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    consoleLogger.info('shutting down', { signal });
    server.shutdown().then(
      () => process.exit(0),
      (err) => {
        consoleLogger.error('shutdown failed', { error: errorMessage(err) });
        process.exit(1);
      },
    );
  });
}

process.on('unhandledRejection', (err) => consoleLogger.error('unhandled rejection', { error: errorMessage(err) }));

await server.listen();
