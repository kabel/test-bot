import {run as fetch} from "./buildArtifact.js"
import {run as ciUpload} from "./ciUpload.js";
import {promises as fsp} from "node:fs";
import {basename} from "node:path";
import minimist from "minimist";
import chalk from "chalk";

function usage() {
    console.log(`${chalk.bold(`Usage: ${basename(process.argv[1])}`)} [${chalk.underline('options')}] ${chalk.underline('tap_name')}

Deploy Homebrew bottles to Homebrew tap ${chalk.underline('tap_name')}.

With the ${chalk.bold('--build-id')} option, the bottle artifact from Azure DevOps Services is downloaded. It is downloaded and extracted to the working directory, avoiding overriding existing local files.

The following configuration items must be in the environment or provided in the ${chalk.bold('--secrets')} option.

    ${chalk.bold('API_URL')}                    URL to the instance and collection/organization of Azure DevOps Services REST API
    ${chalk.bold('API_PROJECT')}                Project id/name in Azsure DevOps Services
    ${chalk.bold('API_TOKEN')}                  Personal Access Token for the REST API (requires build:read scope)
    ${chalk.bold('HOMEBREW_BINTRAY_ORG')}       Bintray organization name to upload to
    ${chalk.bold('HOMEBREW_BINTRAY_USER')}      Bintray user name with upload rights
    ${chalk.bold('HOMEBREW_BINTRAY_KEY')}       Bintray API key for user
    ${chalk.bold('HOMEBREW_GIT_NAME')}          User name to write bottle writing commits with (default: from git config)
    ${chalk.bold('HOMEBREW_GIT_EMAIL')}         Email to write bottle writing commits with (default: from git config)

${chalk.underline('options')}

    ${chalk.bold('-b')} ${chalk.underline('build_id')}                Download artifact from build ${chalk.underline('build_id')}
    ${chalk.bold('--build-id=')}${chalk.underline('build_id')}

    ${chalk.bold('-c')} ${chalk.underline('file')}                    Load environment secrets from JSON ${chalk.underline('file')}
    ${chalk.bold('--secrets=')}${chalk.underline('file')}

    ${chalk.bold('-a')} ${chalk.underline('name')}                    Use artifact named ${chalk.underline('name')} from build (default: drop)
    ${chalk.bold('--artifact=')}${chalk.underline('name')}

    ${chalk.bold('-p')} ${chalk.underline('pr#')}                     Fetch and merge the pull request that initiated this bottle
    ${chalk.bold('--pr=')}${chalk.underline('pr#')}

    ${chalk.bold('-n')}                         Do not push after everything is complete
    ${chalk.bold('--no-push')}

    ${chalk.bold('-d')}                         Just print commands, instead of running them
    ${chalk.bold('--dry-run')}

    ${chalk.bold('-k')}                         Keep old bottles
    ${chalk.bold('--keep-old')}

    ${chalk.bold('-h')}                         Show this message
    ${chalk.bold('--help')}
`
    );
}

interface MainOptions extends minimist.ParsedArgs {
    /**
     * @alias build-id
     */
    b?: number
    /**
     * The number from the Azure DevOps Services build
     */
    "build-id"?: number

    /**
     * @alias secrets
     */
    c?: string
    /**
     * JSON file of secrets to load into the environment
     */
    secrets?: string

    /**
     * @alias artifact
     */
    a: string
    /**
     * Name of the build artifact
     * @default "drop"
     */
    artifact: string

    /**
     * @alias pr
     */
    p?: string
    /**
     * Pull request number that initiated the build
     */
    pr?: number

    /**
     * @alias no-push
     */
    n?: boolean
    /**
     * Do not push after everything is complete
     */
    "no-push"?: boolean

    /**
     * @alias dry-run
     */
    d?: boolean
    /**
     * Just print commands, instead of running them
     */
    "dry-run"?: boolean

    /**
     * @alias help
     */
    h: boolean
    /**
     * Show usage
     */
    help?: boolean
}

async function main() {
    try {
        const opts = minimist<MainOptions>(process.argv.slice(2), {
            alias: {
                "build-id": "b",
                secrets: "c",
                artifact: "a",
                pr: "p",
                "no-push": "n",
                "dry-run": "d",
                "keep-old": "k",
                help: "h"
            },
            default: {artifact: "drop"},
            boolean: ["n", "d", "k", "h"]
        });

        if (process.env.NO_COLOR) {
            chalk.level = 0;
        }

        if (opts.help || !opts._.length) {
            usage();
            process.exit();
        }

        if (opts.secrets) {
            const secrets = JSON.parse((await fsp.readFile(opts.secrets)).toString());
            Object.assign(process.env, secrets);
        }

        if (!opts._[0] || opts._[0].indexOf("/") < 0) {
            throw "tap_name does not match Homebrew format: user/repo"
        }

        let expandedPath = "."
        if (opts["build-id"]) {
            expandedPath = await fetch(opts["build-id"], opts.artifact, {dryRun: opts["dry-run"]});
        }
        await ciUpload(expandedPath, opts._[0], {dryRun: opts["dry-run"], pr: opts.pr, keepOld: opts["keep-old"], noPush: opts["no-push"]});
    } catch (reason:any) {
        let code = reason;
        if (typeof code !== "number") {
            console.error(reason);
            code = 1;
        }
        process.exit(code);
    }
}

main();
