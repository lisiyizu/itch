import { Watcher } from "common/util/watcher";
import { actions } from "common/actions";
import { mainLogger } from "main/logger";
import { mcall } from "main/butlerd/mcall";
import { messages, hookLogging } from "common/butlerd";
import { legacyMarketPath } from "common/util/paths";

const logger = mainLogger.child(__filename);

export default function(watcher: Watcher) {
  watcher.on(actions.setupDone, async (store, action) => {
    logger.info(`Scanning install locations for items...`);
    await mcall(
      messages.InstallLocationsScan,
      {
        legacyMarketPath: legacyMarketPath(),
      },
      convo => {
        hookLogging(convo, logger);
        convo.on(messages.InstallLocationsScanYield, async ({ game }) => {
          logger.info(`Found ${game.title} - ${game.url}`);
        });
        convo.on(
          messages.InstallLocationsScanConfirmImport,
          async ({ numItems }) => {
            logger.info(`In total, found ${numItems} items.`);
            return { confirm: true };
          }
        );
      }
    );
    logger.info(`Scan complete.`);
  });
}
