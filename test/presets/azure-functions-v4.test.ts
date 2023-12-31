import { promises as fsp } from "node:fs";
import { describe, expect, it } from "vitest";
import { join, resolve } from "pathe";
import { getRandomPort, waitForPort } from "get-port-please";
import { ExecaChildProcess, execa } from "execa";
import { setupTest, testNitro } from "../tests";

const PRESET = "azure-functions-v4";
describe(
  `nitro:preset:azure-functions-v4`,
  async () => {
    const ctx = await setupTest(PRESET, {
      config: {},
    });

    const config = await fsp
      .readFile(resolve(ctx.outDir, "server", "local.settings.json"), "utf8")
      .then((r) => JSON.parse(r));

    it("generated the correct config", () => {
      expect(config).toEqual({
        IsEncrypted: false,
        Values: {
          FUNCTIONS_WORKER_RUNTIME: "node",
          AzureWebJobsFeatureFlags: "EnableWorkerIndexing",
        },
      });
    });
    let p: ExecaChildProcess<string>;
    try {
      testNitro(ctx, async () => {
        const port = await getRandomPort();
        const serverDir = resolve(ctx.outDir, "server");
        process.env.PORT = String(port);

        p = execa("func", ["start", "--verbose"], {
          stdio: "pipe",
          all: true,
          cwd: serverDir,
        });
        p.all.on("data", (a) => console.error(String(a)));
        ctx.server = {
          url: `http://127.0.0.1:7071`,
          close: () => p.kill(9),
        } as any;
        try {
          await waitForStringInStdout(
            p.stdout,
            "Host lock lease acquired ",
            10_000
          );
        } catch (error) {
          p.kill();
          throw error;
        }

        return async ({ url, ...opts }) => {
          const res = await ctx.fetch(url, opts);
          return res;
        };
      });
    } catch (error) {
      if (p && !p.killed) {
        p.kill();
      }
      throw error;
    } finally {
      if (p && !p.killed) {
        p.kill(9);
      }
    }
  },
  { timeout: 10_000 }
);

async function waitForStringInStdout(
  stdout: ExecaChildProcess["stdout"],
  targetString: string,
  timeout: number
): Promise<void> {
  const timeoutPromise = new Promise<void>((_resolve, reject) => {
    setTimeout(() => {
      reject(new Error("Timeout"));
    }, timeout);
  });

  const completionPromise = new Promise<void>((resolve) => {
    stdout.on("data", (data: Buffer) => {
      const output = data.toString();
      if (output.includes(targetString)) {
        resolve();
      }
    });
  });

  await Promise.race([completionPromise, timeoutPromise]);
}
