import { AudioFile, MediaFile } from "./file.ts";

type CommonPost = {
  readonly pageUrl: URL;
  readonly description: string;
};

export type SingleFilePost = CommonPost & {
  readonly type: "single-file";
  readonly file: MediaFile;
};

export type MultiFilePost = CommonPost & {
  readonly type: "multi-file";
  readonly files: MediaFile[];
  readonly title?: string;
  readonly audio?: AudioFile;
};

export type QualityVariant = {
  readonly name: string;
  readonly approxByteCount: number;
  readonly type: "audio" | "video";
};

export type MultiQualityVideoPost = CommonPost & {
  readonly type: "multi-quality-video";
  readonly videoId: string;
  readonly thumbnailUrl: string;
  readonly qualityVariants: QualityVariant[];
};

export type FilePost = SingleFilePost | MultiFilePost | MultiQualityVideoPost;

export class PostBuilder {
  static singleFile(args: Omit<SingleFilePost, "type">): SingleFilePost {
    return { type: "single-file", ...args };
  }
  static multiFile(args: Omit<MultiFilePost, "type">): MultiFilePost {
    return { type: "multi-file", ...args };
  }
  static multiQualityVideo(
    args: Omit<MultiQualityVideoPost, "type">,
  ): MultiQualityVideoPost {
    return { type: "multi-quality-video", ...args };
  }
}
