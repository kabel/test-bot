import * as vm from "azure-devops-node-api";
import * as ba from "azure-devops-node-api/BuildApi";
import * as bi from "azure-devops-node-api/interfaces/BuildInterfaces";
import { createWriteStream } from "fs";
import * as cm from "./common";
import Expander from "./expander";

export interface RunOptions {
    dryRun?: boolean
}

export async function run(buildId: number, artifactName: string, opt: RunOptions) {
    const vsts: vm.WebApi = await cm.getWebApi();
    const vstsBuild: ba.IBuildApi = await vsts.getBuildApi();
    const project = cm.getProject();

    cm.heading(`Fetching ${artifactName} for build ${buildId} of ${project} project`);

    if (opt.dryRun) {
        return Expander.defaultExpandTo;
    }

    const artifacts: bi.BuildArtifact[] = await vstsBuild.getArtifacts(project, buildId);
    let download: bi.BuildArtifact | undefined;
    
    if (artifacts) {
        download = artifacts.filter(artifact => artifact.name === artifactName && artifact.resource!.type === "Container")[0];
    }

    if (!download || !download.resource) {
        throw "No downloadable artifact found";
    }

    cm.heading(`Downloading ${download.resource.downloadUrl}`);
    
    const path = Expander.findAvailableName(`${artifactName}.zip`);
    const artifactStream = await vstsBuild.getArtifactContentZip(project, buildId, artifactName);
    return new Promise<string>(resolve => {
        const fileStream = createWriteStream(path);
        artifactStream.pipe(fileStream);
        fileStream.on("close", async () => resolve((await Expander.from(fileStream.path as string)).expand()));
    });
}
