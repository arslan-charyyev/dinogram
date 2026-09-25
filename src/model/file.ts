export type CommonFile = {
  readonly downloadUrl: string;
};

export type VideoFile = CommonFile & {
  readonly type: "video";
};

export type PhotoFile = CommonFile & {
  readonly type: "photo";
};

/**
 * A GIF. Telegram shows a GIF sent as a photo as a still image.
 */
export type AnimationFile = CommonFile & {
  readonly type: "animation";
};

export type AudioFile = CommonFile & {
  readonly type: "audio";
  readonly author: string;
  readonly title: string;
};

/**
 * A file that fits a media group
 */
export type MediaFile = VideoFile | PhotoFile;

/**
 * A media group takes no animation, so only a single post can hold one
 */
export type SingleMediaFile = MediaFile | AnimationFile;

export class FileBuilder {
  static video(args: Omit<VideoFile, "type">): VideoFile {
    return { type: "video", ...args };
  }

  static photo(args: Omit<PhotoFile, "type">): PhotoFile {
    return { type: "photo", ...args };
  }

  static animation(args: Omit<AnimationFile, "type">): AnimationFile {
    return { type: "animation", ...args };
  }

  static audio(args: Omit<AudioFile, "type">): AudioFile {
    return { type: "audio", ...args };
  }
}
