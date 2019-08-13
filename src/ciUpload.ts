import chalk from "chalk";
import { spawn, execFile as execFileCb } from "child_process";
import deepmerge from "deepmerge";
import globby from "globby";
import {promises as fsp, existsSync, createReadStream} from "fs";
import {type as osType, release, arch} from "os";
import path from "path";
import rp from "request-promise-native";
// import rerr from "request-promise-native/errors";
import util from 'util';
import * as cm from "./common";
import request = require("request");

const execFile = util.promisify(execFileCb);
const HOMEBREW_BIN = "brew";
const GIT_BIN = "git";

async function getUserAgent() {
    let product = "";
    let system = osType();
    let processor = arch();
    let osVersion = "";

    if (system === "Darwin") {
        product = "Homebrew";
        system = "Macintosh";
        if (processor === "x32" || processor === "x64") {
            processor = "Intel";
        }
        osVersion = "Mac OS X " + await macosVersion();
    } else {
        product = osType() + "brew";
        osVersion = release();
        if (system === "Linux") {
            osVersion = (await execFile("lsb_release -sd")).stdout.trim() || osVersion;
        }
    }
    const brewRepo = (await execFile(HOMEBREW_BIN, ["--repository"])).stdout.trim();
    const brewVersion = (await execFile(GIT_BIN, ["-C", brewRepo, "describe", "--tags", "--dirty", "--abbrev=7"])).stdout.trim();
    return `${product}/${brewVersion} (${system}; ${processor} ${osVersion})`;
}

function getHttpClient(agent: string) {
    
    return rp.defaults({
        headers: {
            "User-Agent": agent
        },
        forever: true
    });
}

async function macosVersion() {
    return (await execFile("/usr/bin/sw_vers", ["-productVersion"])).stdout.trim();
}

async function macosTag() {
    const UNKNOWN = "dunno";

    if (osType() !== "Darwin") {
        return UNKNOWN;
    }

    const versionNumber = await macosVersion()
    const versionMatcher = versionNumber.substring(0, versionNumber.lastIndexOf("."));
    const SYMBOLS = {
        catalina:    "10.15",
        mojave:      "10.14",
        high_sierra: "10.13",
        sierra:      "10.12",
        el_capitan:  "10.11",
        yosemite:    "10.10",
        mavericks:   "10.9",
    }

    for (const [sym, ver] of Object.entries(SYMBOLS)) {
        if (ver === versionMatcher) {
            return sym;
        }
    }

    return UNKNOWN;
}

function logCommand(command:string, args: readonly string[]) {
    console.log([command].concat(args).join(" "));
}

class ExitStatus extends Boolean {
    error?: Error 
    code: number | null
    signal: string | null

    constructor(codeOrError: number | null | Error, signal: string | null = null) {
        super(codeOrError === 0);
        if (codeOrError instanceof Error) {
            this.code = null
            this.error = codeOrError;
        } else {
            this.code = codeOrError;
        }
        this.signal = signal;
    }

    get isSuccess() {
        return this.valueOf()
    }
}

async function system(command: string, args: readonly string[]) {
    logCommand(command, args);

    return new Promise<ExitStatus>((resolve) => {
        const proc = spawn(command, args);
        proc.stdout.pipe(process.stdout);
        proc.stderr.pipe(process.stderr);
        proc.on("error", err => resolve(new ExitStatus(err)));
        proc.on("exit", (code, signal) => resolve(new ExitStatus(code, signal)));
    });
}

async function safeSystem(command: string, args: readonly string[]) {
    let result = await system(command, args);
    if (result.isSuccess) {
        return;
    }

    throw result.error || result.code
}

export interface RunOptions {
    workingPath: string
    dryRun?: boolean
    pr?: number
    keepOld?: boolean
    noPush?: boolean
}

interface BottlesHash {
    [key: string]: {
        formula: {
            pkg_version: string
            path?: string
        }
        bottle: {
            root_url?: string
            prefix?: string,
            cellar?: string,
            rebuild: number,
            tags: {
                [key: string]: {
                    filename: string
                    local_filename: string
                    sha256: string
                }
            }
        }
        bintray: {
            package: string
            repository: string
        }
    }
}

interface FormulaPackaged {
    [key: string]: boolean
}

export async function run(opts: RunOptions) {
    cm.heading("Deploying bottles to tap");
    process.chdir(opts.workingPath);
    const envTap = cm.getEnv("HOMEBREW_TAP");
    const bintrayOrg = cm.getEnv("HOMEBREW_BINTRAY_ORG");
    const userAgent = await getUserAgent()
    const request = getHttpClient(userAgent);
    let tempArgs: string[] = [];

    Object.assign(process.env, { 
        "HOMEBREW_NO_ENV_FILTERING": "1",
        "HOMEBREW_DEVELOPER": "1",
        "HOMEBREW_NO_AUTO_UPDATE": "1",
        "HOMEBREW_NO_EMOJI": "1"
    });

    //#region `brew test-bot --ci-upload` reimplementation

    tempArgs = ["--repository", envTap]
    const tapPath = (await execFile(HOMEBREW_BIN, tempArgs)).stdout.trim();

    if (!existsSync(tapPath)) {
        tempArgs = ["tap", envTap, "--full"];
        await safeSystem(HOMEBREW_BIN, tempArgs);
    } else if (existsSync(path.join(tapPath, ".git/shallow"))) {
        await execFile(GIT_BIN, ["-C", tapPath, "fetch", "--unshallow"]);
    }
    
    let bintrayAuth: request.AuthOptions = {};
    let bottles: BottlesHash = {};
    let jsonFiles = ["$JSON_FILES"];

    if (!opts.dryRun) {
        bintrayAuth = {
            user: cm.getEnv("HOMEBREW_BINTRAY_USER"),
            pass: cm.getEnv("HOMEBREW_BINTRAY_KEY")
        }
        jsonFiles = await globby("*.bottle.json");
        if (!jsonFiles.length) {
            throw `No bottles found in ${opts.workingPath}`
        }

        bottles = await jsonFiles.reduce(async (prevBottle, file) => {
            const bottle:BottlesHash = JSON.parse((await fsp.readFile(file)).toString())
            return deepmerge<BottlesHash>(await prevBottle, bottle);
        }, Promise.resolve(bottles))
    } else {
        const tag = await macosTag();
        bottles = {
            "testbottest": {
                "formula": {
                    "pkg_version": "1.0.0"
                },
                "bottle": {
                    "rebuild": 0,
                    "tags": {
                    }
                },
                "bintray": {
                    "package": "testbottest",
                    "repository": "bottles"
                }
            }
        };
        bottles.testbottest.bottle.tags[tag] = {
            "filename": `testbottest-1.0.0.${tag}.bottle.tar.gz`,
            "local_filename": `testbottest--1.0.0.${tag}.bottle.tar.gz`,
            "sha256": "20cdde424f5fe6d4fdb6a24cff41d2f7aefcd1ef2f98d46f6c074c36a1eef81e"
        }
    }

    const firstFormulaName = Object.keys(bottles)[0];
    const tapName = firstFormulaName.split("/", 3).slice(0, 2).join("/");

    if (!opts.dryRun && tapName !== envTap) {
        console.warn(chalk`{yellow Warning:} Bottle files don't match environment HOMEBREW_TAP`);
    }

    Object.assign(process.env, {
        "GIT_WORK_TREE": tapPath,
        "GIT_DIR": path.join(tapPath, ".git")
    });

    tempArgs = ["am", "--abort"];
    if (!opts.dryRun) {
        await execFile(GIT_BIN, tempArgs);
    } else {
        logCommand(GIT_BIN, tempArgs);
    }

    tempArgs = ["rebase", "--abort"];
    if (!opts.dryRun) {
        await execFile(GIT_BIN, tempArgs);
    } else {
        logCommand(GIT_BIN, tempArgs);
    }

    tempArgs = ["checkout", "master"];
    if (!opts.dryRun) {
        await safeSystem(GIT_BIN, tempArgs);
    } else {
        logCommand(GIT_BIN, tempArgs);
    }

    // ignoring reset, for now, to allow runs to stack
    // tempArgs = ["reset", "origin/master"];
    // if (!opts.dryRun) {
    //     await safeSystem(GIT_BIN, tempArgs);
    // } else {
    //     logCommand(GIT_BIN, tempArgs);
    // }

    tempArgs = ["pull", "--rebase"];
    if (!opts.dryRun) {
        await safeSystem(GIT_BIN, tempArgs);
    } else {
        logCommand(GIT_BIN, tempArgs);
    }
    
    if (opts.pr) {
        const prRef = `pull/${opts.pr}`;
        tempArgs = ["fetch", "origin", `${prRef}/head:${prRef}`];
        if (!opts.dryRun) {
            await safeSystem(GIT_BIN, tempArgs);
        } else {
            logCommand(GIT_BIN, tempArgs);
        }

        tempArgs = ["rebase", "master", prRef];
        if (!opts.dryRun) {
            await safeSystem(GIT_BIN, tempArgs);
        } else {
            logCommand(GIT_BIN, tempArgs);
        }

        tempArgs = ["checkout", "master"];
        if (!opts.dryRun) {
            await safeSystem(GIT_BIN, tempArgs);
        } else {
            logCommand(GIT_BIN, tempArgs);
        }

        tempArgs = ["merge", prRef];
        if (!opts.dryRun) {
            await safeSystem(GIT_BIN, tempArgs);
        } else {
            logCommand(GIT_BIN, tempArgs);
        }
    }

    tempArgs = ["bottle", "--merge", "--write"];
    if (opts.keepOld) {
        tempArgs.push("--keep-old")
    }
    tempArgs = tempArgs.concat(jsonFiles);
    if (!opts.dryRun) {
        await safeSystem(HOMEBREW_BIN, tempArgs);
    } else {
        logCommand(HOMEBREW_BIN, tempArgs);
    }

    const packaged: FormulaPackaged = {};
    console.log(`Using User-Agent: ${userAgent}`);

    for (let [formulaName, bottle] of Object.entries(bottles)) {
        const version = bottle.formula.pkg_version;
        const bintrayPackage = bottle.bintray.package;
        const bintrayRepo = bottle.bintray.repository;
        const bintrayRoot = bottle.bottle.root_url || `https://homebrew.bintray.com/${bintrayRepo}`;
        const bintrayPackagesUrl = `https://api.bintray.com/packages/${bintrayOrg}/${bintrayRepo}`;
        const bintrayPackageFilesUrl = `https://bintray.com/${bintrayOrg}/${bintrayRepo}/${bintrayPackage}/view#files`;
        const bintrayContentUrl = `https://api.bintray.com/content/${bintrayOrg}/${bintrayRepo}/${bintrayPackage}/${version}`

        for (let tagHash of Object.values(bottle.bottle.tags)) {
            const filename = tagHash.filename;
            let alreadyPublished = false;
            let bintrayUrl = `${bintrayRoot}/${filename}`;
            console.log(`curl -I --output /dev/null ${bintrayUrl}`)
            if (!opts.dryRun) {
                await request.head(bintrayUrl).then(() => alreadyPublished = true, () => {});
            }

            if (alreadyPublished) {
                throw `${filename} is already published. Please remove it manually from
${bintrayPackageFilesUrl}`;
            }
            
            if (!packaged[formulaName]) {
                bintrayUrl = `${bintrayPackagesUrl}/${bintrayPackage}`;
                let packageExists = false;
                console.log(`curl --output /dev/null ${bintrayUrl}`);
                if (!opts.dryRun) {
                    await request.get(bintrayUrl).then(() => packageExists = true, () => {});
                }

                if (!packageExists) {
                    const [tapUser, tapRepo] = envTap.split("/");
                    const packageBlob = {
                        name: bintrayPackage,
                        public_download_numbers: true,
                        licenses: ["BSD 2-Clause"],
                        vcs_url: `https://github.com/${tapUser}/homebrew-${tapRepo}`
                    };

                    console.log(`curl --user $HOMEBREW_BINTRAY_USER:$HOMEBREW_BINTRAY_KEY
     --header Content-Type: application/json
     --data ${JSON.stringify(packageBlob)}
     ${bintrayPackagesUrl}`
                    );
                    if (!opts.dryRun) {
                        await request.post(bintrayPackagesUrl, {auth: bintrayAuth, json: true});
                    }
                }

                packaged[formulaName] = true;
            }

            bintrayUrl = `${bintrayContentUrl}/${filename}?publish=1`;
            console.log(`curl --user $HOMEBREW_BINTRAY_USER:$HOMEBREW_BINTRAY_KEY
     --upload-file ${tagHash.local_filename}
     ${bintrayUrl}`
            );
            if (!opts.dryRun) {
                await createReadStream(tagHash.local_filename).pipe(request.put(bintrayUrl, {auth: bintrayAuth}));
            }
        }
    }

    if (!opts.noPush) {
        tempArgs = ["push"];
        if (!opts.dryRun) {
            await safeSystem(GIT_BIN, tempArgs);
        } else {
            logCommand(GIT_BIN, tempArgs);
        }
    }

    //#endregion

    
    // // avoid falling back to BrewTestBot <homebrew-test-bot@lists.sfconservancy.org> values
    // let gitName = process.env.HOMEBREW_GIT_NAME;
    // if (!gitName) {
    //     gitName = (await execFile(GIT_BIN, ["config", "user.name"])).stdout.trim();
    // }
    // let gitEmail = process.env.HOMEBREW_GIT_EMAIL;
    // if (!gitEmail) {
    //     gitEmail = (await execFile(GIT_BIN, ["config", "user.email"])).stdout.trim();
    // }
    // if (opts.pr) {
    //     Object.assign(process.env, {"CHANGE_ID": opts.pr});
    // }
    // const brewArgs = [
    //     "test-bot",
    //     "--ci-upload",
    //     `--tap=${envTap}`,
    //     `--bintray-org=${bintrayOrg}`,
    //     `--git-name=${gitName}`,
    //     `--git-email=${gitEmail}`
    // ];
    // if (opts.dryRun) {
    //     brewArgs.push("--dry-run");
    // }
    // if (opts.keepOld) {
    //     brewArgs.push("--keep-old")
    // }
    
    // await safeSystem(HOMEBREW_BIN, brewArgs);
}
