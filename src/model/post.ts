import { AudioFile, MediaFile } from "./file.ts";

type CommonPost = {
  readonly pageUrl: URL;
  readonly description: string;
};

export type SingleFilePost = CommonPost & {
  readonly type: "single";
  readonly file: MediaFile;
};

export type MultiFilePost = CommonPost & {
  readonly type: "multi";
  readonly files: MediaFile[];
  readonly title?: string;
  readonly audio?: AudioFile;
};

export type FilePost = SingleFilePost | MultiFilePost;

export class PostBuilder {
  static single(args: Omit<SingleFilePost, "type">): SingleFilePost {
    return { type: "single", ...args };
  }
  static multi(args: Omit<MultiFilePost, "type">): MultiFilePost {
    return { type: "multi", ...args };
  }
}
