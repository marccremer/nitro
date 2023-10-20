import { createWriteStream } from "node:fs";
import * as fs from "node:fs";
import archiver from "archiver";
import { join, resolve } from "pathe";
import { writeFile } from "../utils";
import { defineNitroPreset } from "../preset";
import type { Nitro } from "../types";

export const azureFunctions = defineNitroPreset({
  serveStatic: true,
  entry: "#internal/nitro/entries/azure-functions",
  commands: {
    deploy:
      "az functionapp deployment source config-zip -g <resource-group> -n <app-name> --src {{ output.dir }}/deploy.zip",
  },
  hooks: {
    async compiled(ctx: Nitro) {
      await writeRoutes(ctx);
    },
  },
});

async function writeRoutes(nitro: Nitro) {
  const host = {
    version: "2.0",
    extensionBundle: {
      id: "Microsoft.Azure.Functions.ExtensionBundle",
      version: "[4.*, 5.0.0)",
    },
    extensions: {
      http: {
        routePrefix: nitro.options.baseURL.slice(1, -1),
      },
    },
  };
  const localSettings = {
    IsEncrypted: false,
    Values: {
      FUNCTIONS_WORKER_RUNTIME: "node",
      AzureWebJobsFeatureFlags: "EnableWorkerIndexing",
    },
  };
  const serverDir = "server";

  await writeFile(
    resolve(nitro.options.output.dir, serverDir, "host.json"),
    JSON.stringify(host)
  );
  await writeFile(
    resolve(nitro.options.output.dir, serverDir, "local.settings.json"),
    JSON.stringify(localSettings)
  );
  const packagePath = resolve(
    nitro.options.output.dir,
    serverDir,
    "package.json"
  );

  const p = readFileAsJson(packagePath);
  p.main = "./*.mjs";

  await writeFile(packagePath, JSON.stringify(p));
}

function readFileAsJson(filePath: string): any {
  try {
    const fileContent = fs.readFileSync(filePath, "utf8");
    const jsonData = JSON.parse(fileContent);
    return jsonData;
  } catch (error) {
    throw new Error(
      `Error reading or parsing JSON file at ${filePath}: ${error.message}`
    );
  }
}
