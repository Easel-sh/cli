#!/usr/bin/env node

import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { CLI_VERSION } from "./lib/version.js";
import { registerCommands } from "./register-commands.js";

const app = yargs(hideBin(process.argv))
  .scriptName("easel")
  .version(CLI_VERSION)
  .alias("version", "V");

registerCommands(app)
  .demandCommand(1, "Specify a command. Run `easel --help` to see them all.")
  .strict()
  .help()
  .alias("help", "h")
  .fail((message, error, yargsInstance) => {
    if (error) {
      console.error(error.message || message);
    } else {
      console.error(message);
      yargsInstance.showHelp("error");
    }
    process.exit(1);
  });

void app.parseAsync().catch((error: Error) => {
  console.error(error.message);
  process.exit(1);
});
