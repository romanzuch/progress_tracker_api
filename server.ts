import 'dotenv/config';
import { createApp } from './app/config/app.conf.js';
import { connect } from './app/database/index.js';
import { logger } from './app/utils/Logger.util.js';

const port = Number(process.env.PORT ?? 3000);

async function main(): Promise<void> {
  await connect();

  const app = createApp();
  app.listen(port, () => {
    logger.info(`Server listening on port ${port}`);
  });
}

main().catch((err) => {
  logger.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
