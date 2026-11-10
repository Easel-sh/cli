import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

/** This package's version, from package.json. */
export const CLI_VERSION: string = (require("../../package.json") as { version: string }).version;
