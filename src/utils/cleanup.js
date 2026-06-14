const logger = require('../logger');

function registerCleanup(recorder, browserManager) {
  let cleaning = false;

  async function cleanup(signal) {
    if (cleaning) return;
    cleaning = true;
    logger.info(`Received ${signal} — cleaning up...`);

    try {
      await recorder.stopRecording();
    } catch (err) {
      logger.error(`Error stopping recorder: ${err.message}`);
    }

    try {
      await browserManager.close();
    } catch (err) {
      logger.error(`Error closing browser: ${err.message}`);
    }

    logger.info('Meeting ended');
    process.exit(0);
  }

  process.on('SIGINT', () => cleanup('SIGINT'));
  process.on('SIGTERM', () => cleanup('SIGTERM'));
  process.on('uncaughtException', (err) => {
    logger.error(`Uncaught exception: ${err.stack}`);
    cleanup('uncaughtException');
  });
}

module.exports = { registerCleanup };
