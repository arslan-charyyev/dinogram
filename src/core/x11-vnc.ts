import { log } from "./log.ts";
import getPort, { portNumbers } from "get-port";

/**
 * A wrapper class for launching the x11vnc process
 */
export class X11Vnc {
  private constructor(
    private readonly rfbPort: number,
    private readonly process: Deno.ChildProcess,
  ) {
    process.output().then((status) => this.onProcessFinished(status));
  }

  public static async start(display: string): Promise<X11Vnc> {
    const rfbPort = await getPort({ port: portNumbers(5900, 6000) });
    const ncache = 10; // TODO: Read more about this optimization

    const command = new Deno.Command("x11vnc", {
      args: [
        // Arrays are used to group key-value parse and
        // prevent formatter from splitting them on separate lines.
        ...["-display", display],
        ...["-rfbport", rfbPort.toString()],
        ...["-ncache", ncache.toString()],
        "-nopw", // TODO: Generate password
        "-forever",
        "-localhost",
      ],
      stdout: "piped",
      stderr: "piped",
    });

    const process = command.spawn();

    return new X11Vnc(rfbPort, process);
  }

  public stop() {
    this.process.kill("SIGINT");
  }

  private async onProcessFinished(status: Deno.CommandStatus) {
    // We can access these props only once
    const { code, success, signal } = status;

    log.debug(
      `x11vnc finished with code: ${code}, signal: ${signal}`,
    );

    // `signal` is actually null here (probably a bug),
    // but it doesn't matter since `success` will be `true`
    // when we kill the process with "SIGINT"
    if (success || signal === "SIGINT") {
      // We finished successfully or we terminated as intended
      return;
    }

    // Otherwise, we crash with dump of x11vnc error logs
    const out = await this.process.output();
    console.error(new TextDecoder().decode(out.stderr));

    // Crash the program to force restart
    throw new Error(`x11vnc error. Status code: ${code}`);
  }

  public frontendURL(): URL {
    // TODO: Start real frontend
    const url = new URL("http://127.0.0.1:5173");

    const params = {
      autoconnect: "true",
      // TODO: Get host from config
      path: `http://127.0.0.1:${this.rfbPort}`,
    };

    for (const [key, value] of Object.entries(params)) {
      url.searchParams.append(key, value);
    }

    return url;
  }
}
