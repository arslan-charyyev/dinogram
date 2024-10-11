export type CommonFile = {
  readonly downloadUrl: string;
};

export type VideoFile = CommonFile & {
  readonly type: "video";
};

export type PhotoFile = CommonFile & {
  readonly type: "photo";
};

export type AudioFile = CommonFile & {
  readonly type: "audio";
  readonly author: string;
  readonly title: string;
};

export type MediaFile = VideoFile | PhotoFile;

export class FileBuilder {
  static video(args: Omit<VideoFile, "type">): VideoFile {
    return { type: "video", ...args };
  }

  static photo(args: Omit<PhotoFile, "type">): PhotoFile {
    return { type: "photo", ...args };
  }

  static audio(args: Omit<AudioFile, "type">): AudioFile {
    return { type: "audio", ...args };
  }
}
