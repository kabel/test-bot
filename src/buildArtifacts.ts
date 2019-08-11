// A sample showing how to list VSTS build artifacts, and how to download a zip of a VSTS build artifact.
import * as cm from "./common";
import * as vm from "azure-devops-node-api";
import * as fs from "fs";
import { spawn } from "child_process";

import * as ba from "azure-devops-node-api/BuildApi";
import * as bi from "azure-devops-node-api/interfaces/BuildInterfaces";
import Expander from "./expander";

async function deploy(outPath: string) {
    const expander = await Expander.from(outPath);
    await expander.expand();

    try {
        process.chdir(expander.expandTo as string)
        await new Promise((resolve, reject) => {
            const brewArgs = [
                "test-bot",
                "--ci-upload",
                // "--dry-run",
                `--tap=${process.env.HOMEBREW_TAP}`,
                `--bintray-org=${process.env.HOMEBREW_BINTRAY_ORG}`,
                `--git-name=${process.env.HOMEBREW_GIT_NAME}`,
                `--git-email=${process.env.HOMEBREW_GIT_EMAIL}`
            ];
            console.log("brew " + brewArgs.join(" "));
            const proc = spawn("brew", brewArgs);
            proc.stdout.pipe(process.stdout);
            proc.stderr.pipe(process.stderr);
            proc.on("exit", code => {
                if (code === 0) {
                    resolve();
                } else {
                    reject(code);
                }
            });
        });
    } catch (reason) {
        let code = reason;
        if (typeof reason !== "number") {
            console.error(reason);
            code = 1;
        }
        process.exit(code);
    }
}

export async function run(buildId: number) {
    try {
        if (Number.isNaN(buildId)) {
            throw new Error("buildId is not a number")
        }
        const vsts: vm.WebApi = await cm.getWebApi();
        const vstsBuild: ba.IBuildApi = await vsts.getBuildApi();
        const project = cm.getProject();
        const artifacts: bi.BuildArtifact[] = await vstsBuild.getArtifacts(project, buildId);
        let downloadableArtifact: bi.BuildArtifact | undefined;
        
        if (artifacts) {
            downloadableArtifact = artifacts.filter(artifact => artifact.name === "drop" && artifact.resource!.type === "Container")[0]
        }
            
        // Download an artifact.
        if (downloadableArtifact) {
            cm.heading(`Fetching ${downloadableArtifact.name} for build ${buildId} of ${project} project`);
            cm.heading(`Downloading ${downloadableArtifact.resource!.downloadUrl}`);
            const artifactStream: NodeJS.ReadableStream = await vstsBuild.getArtifactContentZip(project, buildId, downloadableArtifact.name || "");
            const path = Expander.findAvailableName(`${downloadableArtifact.name}.zip`);
            const fileStream = fs.createWriteStream(path);
            artifactStream.pipe(fileStream);
            fileStream.path
            fileStream.on("close", () => deploy(fileStream.path as string));
        } else {
            throw new Error("No downloadable artifact found.");
        }
    } catch (err) {
        console.error(err.message);
        process.exit(1)
    }
}
