import { errorMessage } from "@yu-iskw/xbot-core";
import { startXbotSlackServer } from "./serve";

startXbotSlackServer()
  .then((server) => {
    process.stderr.write(`xbot Slack webhook listening at ${server.webhookUrl}\n`);
    const shutdown = () => void server.close().then(() => process.exit(0));
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  })
  .catch((error: unknown) => {
    process.stderr.write(`xbot-slack: ${errorMessage(error)}\n`);
    process.exit(1);
  });
