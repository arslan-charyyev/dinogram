type CommonStream = {
  stream: ReadableStream<Uint8Array>;
};

export type PhotoStream = CommonStream & {
  type: "photo";
};

export type VideoStream = CommonStream & {
  type: "video";
};

export type MediaStream = PhotoStream | VideoStream;
