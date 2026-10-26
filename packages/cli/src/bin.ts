import { main } from "./program";

main(process.argv).then((code) => {
  process.exitCode = code;
});
