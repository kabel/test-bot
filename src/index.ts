import * as task from "./buildArtifacts"
import * as fs from "fs";
const fsp = fs.promises;

async function main() {
    let opts = [];
    let secretsFile = ".secrets.json";

    for (let i = 2; i < process.argv.length; ++i) {
        if (process.argv[i] === "-c") {
            secretsFile = process.argv[++i];
        } else {
            opts.push(process.argv[i]);
        }
    }

    try {
        const data = await fsp.readFile(secretsFile);
        const secrets = JSON.parse(data.toString());
        for (const name in secrets) {
            process.env[name] = secrets[name];
        }
        process.env.HOMEBREW_NO_ENV_FILTERING = "1";
        await task.run(Number.parseInt(opts[0]));
    } catch (reason) {
        console.error(reason)
        process.exit(1)
    }
}
main();
