import {promises as fsp, existsSync, createWriteStream} from "fs";
import path from "path";
import JSZip from "jszip";

export default class Expander {
    zip: JSZip;
    isBomb: boolean;
    rootFile: JSZip.JSZipObject | null;
    wrapPath: string | null;

    static defaultExpandTo = ".";

    static async from(outPath: string) {
        return new this(outPath, await JSZip.loadAsync(await fsp.readFile(outPath)));
    }

    static findAvailableName(outPath: string) {
        const isDir = outPath.endsWith(path.sep)
        const origPath = path.parse(outPath);
        let newName = outPath;
        for (let i = 1; existsSync(newName); ++i) {
            newName = origPath.name + "-" + i + origPath.ext + (isDir ? path.sep : "");
        }

        return newName;
    }

    constructor(outPath: string, zip: JSZip) {
        this.zip = zip;
        const topLevel = zip.filter(relPath => path.parse(relPath).dir === "");
        this.isBomb = topLevel.length > 1;

        if (this.isBomb) {
            this.wrapPath = path.parse(outPath).name;
            this.rootFile = null
        } else {
            this.rootFile = topLevel[0];
            this.wrapPath = null;
        }
    }

    async expand() {
        const prevWd = process.cwd();
        let expandTo = Expander.defaultExpandTo;

        try {
            if (this.wrapPath) {
                this.wrapPath = Expander.findAvailableName(this.wrapPath)
                expandTo = this.wrapPath;
            } else if (this.rootFile) {
                let newName = Expander.findAvailableName(this.rootFile.name);

                if (this.rootFile.dir) {
                    expandTo = newName;
                    if (newName !== this.rootFile.name) {
                        this.zip.filter((relPath) => relPath.startsWith(this.rootFile!.name)).forEach(file => {
                            file.name = newName + file.name.substring(file.name.indexOf(path.sep) + 1);
                        });
                    }
                }
                this.rootFile.name = newName;
            }

            if (this.wrapPath) {
                process.chdir(this.wrapPath);
            }

            const utimesPromises:Promise<void>[] = [];

            for (const name in this.zip.files) {
                const file = this.zip.files[name];

                if (file.dir) {
                    await fsp.mkdir(file.name, file.unixPermissions);
                } else {
                    await new Promise(resolve => {
                        let fileStream = createWriteStream(file.name, {mode: file.unixPermissions as number});
                        file.nodeStream().pipe(fileStream);
                        fileStream.on("close", () => resolve());
                    });
                    utimesPromises.push(fsp.utimes(file.name, file.date, file.date));
                }
            }

            utimesPromises.concat(this.zip.filter((_, file) => file.dir).map(
                async file => await fsp.utimes(file.name, file.date, file.date)
            ));
            await Promise.all(utimesPromises);

            return expandTo
        } finally {
            if (prevWd) {
                process.chdir(prevWd);
            }
        }
    }
}
