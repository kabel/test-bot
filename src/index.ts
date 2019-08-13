import * as fetch from "./buildArtifact"
import * as ciUpload from "./ciUpload";
import {promises as fsp} from "fs";
import {basename} from "path";
import minimist from "minimist";
import chalk from "chalk";

function usage() {
    console.log(chalk`{bold Usage: ${basename(process.argv[1])}} [{underline options}] {underline build_id} {underline tap_name}

Deploy Homebrew bottle artifact from Azure DevOps Services with {underline build_id} to Homebrew tap {underline tap_name}.
The artifact is downloaded and extracted to the working directory, avoiding overriding existing local files.

The following configuration items must be in the environment or provided in the {bold --secrets} option.

    {bold API_URL}                    URL to the instance and collection/organization
                               of Azure DevOps Services REST API
    {bold API_PROJECT}                Project id/name in Azsure DevOps Services
    {bold API_TOKEN}                  Personal Access Token for the REST API
                               (requires build:read scope)
    {bold HOMEBREW_BINTRAY_ORG}       Bintray organization name to upload to    
    {bold HOMEBREW_BINTRAY_USER}      Bintray user name with upload rights
    {bold HOMEBREW_BINTRAY_KEY}       Bintray API key for user
    {bold HOMEBREW_GIT_NAME}          User name to write bottle writing commits with
                               (default: from git config)
    {bold HOMEBREW_GIT_EMAIL}         Email to write bottle writing commits with
                               (default: from git config)

{underline options}

    {bold -c} {underline file}                    Load environment secrets from JSON {underline file}
    {bold --secrets=}{underline file}

    {bold -a} {underline name}                    Use artifact named {underline name} from build
    {bold --artifact=}{underline name}            (default: drop)

    {bold -p} {underline pr#}                     Fetch and merge the pull request that initiated 
    {bold --pr=}{underline pr#}                   this bottle

    {bold -n}                         Do not push after everything is complete
    {bold --no-push}

    {bold -d}                         Just print commands, instead of running them
    {bold --dry-run}

    {bold -h}                         Show this message
    {bold --help}
`
    );
}

async function main() {
    try {
        const opts = minimist(process.argv.slice(2), {
            alias: {
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
            chalk.enabled = false;
        }

        if (opts.help || !opts._.length) {
            usage();
            process.exit();
        }

        let secrets = {};
        if (opts.secrets) {
            secrets = JSON.parse((await fsp.readFile(opts.secrets)).toString());
        }
        Object.assign(process.env, secrets, {"HOMEBREW_NO_ENV_FILTERING": "1"})

        const buildId = Number.parseInt(opts._[0]);
        if (Number.isNaN(buildId)) {
            console.error("build_id is not a number");
            usage();
            process.exit(1);
        }

        if (!opts._[1]) {
            console.error("tap_name is required");
            usage();
            process.exit(1);
        }

        const expandedPath = await fetch.run({buildId: buildId, artifactName: opts.artifact, dryRun:opts.d});
        await ciUpload.run(expandedPath, opts._[1], {dryRun:opts.d, pr: opts.pr, noPush: opts.n});
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
