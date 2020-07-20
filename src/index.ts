import {run as fetch} from "./buildArtifact"
import {run as ciUpload} from "./ciUpload";
import {promises as fsp} from "fs";
import {basename} from "path";
import minimist from "minimist";
import chalk from "chalk";

function usage() {
    console.log(chalk`{bold Usage: ${basename(process.argv[1])}} [{underline options}] {underline tap_name}

Deploy Homebrew bottles to Homebrew tap {underline tap_name}. 

With the {bold --build-id} option, the bottle artifact from Azure DevOps Services is downloaded. It is downloaded and extracted to the working directory, avoiding overriding existing local files.

The following configuration items must be in the environment or provided in the {bold --secrets} option.

    {bold API_URL}                    URL to the instance and collection/organization of Azure DevOps Services REST API
    {bold API_PROJECT}                Project id/name in Azsure DevOps Services
    {bold API_TOKEN}                  Personal Access Token for the REST API (requires build:read scope)
    {bold HOMEBREW_BINTRAY_ORG}       Bintray organization name to upload to    
    {bold HOMEBREW_BINTRAY_USER}      Bintray user name with upload rights
    {bold HOMEBREW_BINTRAY_KEY}       Bintray API key for user
    {bold HOMEBREW_GIT_NAME}          User name to write bottle writing commits with (default: from git config)
    {bold HOMEBREW_GIT_EMAIL}         Email to write bottle writing commits with (default: from git config)

{underline options}

    {bold -b} {underline build_id}                Download artifact from build {underline build_id}
    {bold --build-id=}{underline build_id}

    {bold -c} {underline file}                    Load environment secrets from JSON {underline file}
    {bold --secrets=}{underline file}

    {bold -a} {underline name}                    Use artifact named {underline name} from build (default: drop)
    {bold --artifact=}{underline name}

    {bold -p} {underline pr#}                     Fetch and merge the pull request that initiated this bottle
    {bold --pr=}{underline pr#}

    {bold -n}                         Do not push after everything is complete
    {bold --no-push}

    {bold -d}                         Just print commands, instead of running them
    {bold --dry-run}

    {bold -h}                         Show this message
    {bold --help}
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
                help: "h"
            },
            default: {artifact: "drop"},
            boolean: ["n", "d", "h"]
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
        await ciUpload(expandedPath, opts._[0], {dryRun: opts["dry-run"], pr: opts.pr, noPush: opts["no-push"]});
    } catch (reason) {
        let code = reason;
        if (typeof code !== "number") {
            console.error(reason);
            code = 1;
        }
        process.exit(code);
    }
}

main();
