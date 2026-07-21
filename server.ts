import 'dotenv/config';
import { createApp } from './app/config/app.conf.js';
import { logger } from './app/utils/Logger.util.js';

const port = Number(process.env.PORT ?? 3000);
const app = createApp();

app.listen(port, () => {
  logger.info(`Server listening on port ${port}`);
});
