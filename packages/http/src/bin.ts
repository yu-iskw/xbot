import { errorMessage } from "@yu-iskw/xbot-core";
import { startXbotHttpServer } from "./serve";

startXbotHttpServer()
  .then((server) => {
    process.stderr.write(`xbot HTTP API listening on ${server.url} (X mode: ${server.runtime.info.xMode})\n`);
    const shutdown = () => void server.close().then(() => process.exit(0));
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  })
  .catch((error: unknown) => {
    process.stderr.write(`xbot-http: ${errorMessage(error)}\n`);
    process.exit(1);
  });
