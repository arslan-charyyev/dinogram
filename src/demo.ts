import { Xvfb } from "xvfb-ts";
import { getBrowserInstance } from "./core/browser.ts";

class X11Vnc {
  #process: Deno.ChildProcess | null = null;
  readonly rfbport = 5905;

  constructor(readonly display: string) {}

  start() {
    if (this.#process) return this.#process;

    const command = new Deno.Command("x11vnc", {
      args: [
        ...["-display", this.display],
        ...["-rfbport", this.rfbport.toString()],
        ...["-ncache", `${10}`],
        "-nopw", // TODO: Generate password
        "-forever",
        "-localhost",
      ],
      stdout: "piped",
      stderr: "piped",
    });

    const process = command.spawn();

    process.status.then(async (status) => {
      // We can access these props only once
      const { code, success, signal } = status;

      console.log(
        `x11vnc finished with code: ${code}, signal: ${signal}`,
      );

      if (!success) {
        // Print error logs
        const out = await process.output();
        console.error(new TextDecoder().decode(out.stderr));

        // Crash the program to force restart
        throw new Error(`x11vnc error. Status code: ${code}`);
      }
    });

    this.#process = process;

    return process;
  }
}

const xvfb = new Xvfb();
const x11vnc = new X11Vnc(xvfb.display());

await xvfb.start();
await x11vnc.start();

const browser = await getBrowserInstance([
  `--display=${xvfb.display()}`,
]);

const [page] = await browser.pages();
page.goto("https://google.com/", { timeout: 0 });

await page.screenshot({ path: "test_output/screenshot.png" });

await browser.close();

await xvfb.stop();
