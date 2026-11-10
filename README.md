# Easel CLI

Deploy and manage apps on [Easel](https://easel.sh) from your terminal.

```sh
npx easel-sh deploy
```

Or install it globally to get the `easel` command:

```sh
npm install -g easel-sh
easel --help
```

Requires Node.js 20 or later.

## Sign in

```sh
easel login    # opens your browser and saves a token for one workspace
easel whoami   # shows the signed-in user and workspace
easel logout   # removes the saved token from this machine
```

`easel logout` doesn't revoke the token; do that under **Settings → Access
Tokens**.

In CI, create a token under **Settings → Access Tokens** and set `EASEL_TOKEN`
instead. `--token` overrides both.

## Deploy

```sh
easel deploy          # deploy the current directory as a preview
easel deploy --prod   # deploy to production
easel deploy --wait   # wait until it's ready
```

The first deploy in a folder links it to a project, creating one if needed.
When `easel deploy` creates the project, that first deployment goes to
production; later deploys are previews unless you pass `--prod`. Run
`easel link` to link a folder on its own, or `easel link --repo` for a
monorepo.

## Inspect and debug

```sh
easel ls                       # recent deployments
easel inspect <id-or-url>      # one deployment; add --logs for build logs
easel logs --follow            # live request logs
```

## Scripting

Output is JSON when stdout isn't a terminal, so piping a command into `jq`
just works. Pass `--format json` or `--format human` to choose explicitly.
`whoami`, `ls`, `inspect`, `deploy` and `logs` print JSON; prompts and
progress messages go to stderr.

## Documentation

Full reference: [easel.sh/docs/cli](https://easel.sh/docs/cli). To call the
API from code, use [`@easel-sh/sdk`](https://www.npmjs.com/package/@easel-sh/sdk).
