import { resolve } from "@std/path";
import memoizee from "memoizee";
import puppeteer from "puppeteer";
import { config } from "./config.ts";
import { log } from "./log.ts";
import { Xvfb } from "xvfb-ts";
import { X11Vnc as X11VNC } from "./x11-vnc.ts";

export class VNCBrowser {
  private x11vnc?: X11VNC;

  private constructor(
    private readonly xvfb: Xvfb,
    private readonly browser: puppeteer.Browser,
  ) {}

  /**
   * @returns A single global browser instance, meant to be used to fetch content
   */
  public static instance = memoizee(VNCBrowser.new, { promise: true });

  /**
   * @return A new browser instance, meant to be streamed over http(s)/ws(s)
   */
  public static async new(): Promise<VNCBrowser> {
    const xvfb = new Xvfb();

    log.debug("Starting X virtual frame buffer...");
    await xvfb.start();

    // Specify user data directory to persist it if necessary
    const userDataDir = config.DATA_DIR
      ? resolve(config.DATA_DIR, "chrome-data")
      : undefined;

    if (userDataDir) {
      // Attempt to clear lock files left over from previous crashes
      for (const file of ["ProcessSingleton", "SingletonLock"]) {
        const path = resolve(userDataDir, file);

        try {
          // Some of the files are symlinks,
          // so checking their existence is cumbersome.
          // Hence we just try to remove it and ignore any errors
          await Deno.remove(path);
        } catch (_) { /* ignore */ }
      }
    }

    log.debug("Launching puppeteer browser...");
    const browser = await puppeteer.launch({
      args: [
        `--display=${xvfb.display()}`, // Render in the virtual frame buffer
        "--hide-crash-restore-bubble",
      ],
      headless: false, // We want to stream the UI
      userDataDir: userDataDir,
      defaultViewport: null, // Default is 800x600
    });

    log.debug(`Browser launched: ${await browser.version()}`);

    return new VNCBrowser(xvfb, browser);
  }

  public async close() {
    this.stopVncServer();

    log.debug("Closing puppeteer browser");
    await this.browser.close();

    log.debug("Stopping X virtual frame buffer");
    await this.xvfb.stop();
  }

  public async startVncServer(): Promise<URL> {
    if (this.x11vnc) {
      throw new Error(
        "Attempted to start an x11vnc server when it is already running",
      );
    }

    log.debug("Starting x11vnc server...");
    const x11vnc = await X11VNC.start(this.xvfb.display());

    this.x11vnc = x11vnc;

    return x11vnc.frontendURL();
  }

  private stopVncServer() {
    const { x11vnc } = this;
    if (!x11vnc) return;

    this.x11vnc = undefined;

    log.debug("Stopping x11vnc server...");
    x11vnc.stop();
  }

  public newPage() {
    return this.browser.newPage();
  }

  public cookies() {
    return this.browser.cookies();
  }

  public setCookie(...cookies: puppeteer.CookieData[]) {
    return this.browser.setCookie(...cookies);
  }

  public deleteCookie(...cookies: puppeteer.Cookie[]) {
    return this.browser.deleteCookie(...cookies);
  }
}
