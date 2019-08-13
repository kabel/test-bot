import * as vm from "azure-devops-node-api";
// import * as lim from "azure-devops-node-api/interfaces/LocationsInterfaces";
import chalk from "chalk";

export function getEnv(name: string): string {
    let val = process.env[name];
    if (!val) {
        throw `${name} env var not set`;
    }
    return val;
}

export async function getWebApi(serverUrl?: string): Promise<vm.WebApi> {
    serverUrl = serverUrl || getEnv("API_URL");
    return await getApi(serverUrl);
}

export async function getApi(serverUrl: string): Promise<vm.WebApi> {
    let token = getEnv("API_TOKEN");
    let authHandler = vm.getPersonalAccessTokenHandler(token);
    let option = undefined;

    // The following sample is for testing proxy
    // option = {
    //     proxy: {
    //         proxyUrl: "http://127.0.0.1:8888"
    //         // proxyUsername: "1",
    //         // proxyPassword: "1",
    //         // proxyBypassHosts: [
    //         //     "github\.com"
    //         // ],
    //     },
    //     ignoreSslError: true
    // };

    // The following sample is for testing cert
    // option = {
    //     cert: {
    //         caFile: "E:\\certutil\\doctest\\ca2.pem",
    //         certFile: "E:\\certutil\\doctest\\client-cert2.pem",
    //         keyFile: "E:\\certutil\\doctest\\client-cert-key2.pem",
    //         passphrase: "test123",
    //     },
    // };

    let vsts: vm.WebApi = new vm.WebApi(serverUrl, authHandler, option);
    await vsts.connect();
    // console.log(`Hello ${connData.authenticatedUser!.providerDisplayName}`);
    return vsts;
}

export function getProject(): string {
    return getEnv("API_PROJECT");
}

export function heading(title: string): void {
    console.log(chalk`{blue ==>} {bold ${title}}`);
}
