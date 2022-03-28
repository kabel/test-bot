import vm from "azure-devops-node-api";
import ba from "azure-devops-node-api/BuildApi";
import bi from "azure-devops-node-api/interfaces/BuildInterfaces";
import {createWriteStream} from "node:fs";
import {getWebApi, getProject, heading} from "./common.js";
import Expander from "./expander.js";

export interface RunOptions {
    dryRun?: boolean
}

export async function run(buildId: number, artifactName: string, opt: RunOptions) {
    const vsts: vm.WebApi = await getWebApi();
    const vstsBuild: ba.IBuildApi = await vsts.getBuildApi();
    const project = getProject();

    heading(`Fetching ${artifactName} for build ${buildId} of ${project} project`);

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

    heading(`Downloading ${download.resource.downloadUrl}`);
    
    const path = Expander.findAvailableName(`${artifactName}.zip`);
    const artifactStream = await vstsBuild.getArtifactContentZip(project, buildId, artifactName);
    return new Promise<string>(resolve => {
        const fileStream = createWriteStream(path);
        artifactStream.pipe(fileStream);
        fileStream.on("close", async () => resolve((await Expander.from(fileStream.path as string)).expand()));
    });
}
