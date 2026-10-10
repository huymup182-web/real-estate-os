/**
 * Dựng kịch bản cảnh cho video AI (TASK-150, MASTER_PLAN mục 19), tách riêng để test. Video gồm cảnh mở đầu, các cảnh
 * ảnh có điểm nổi bật, cảnh thông tin (giá, diện tích, khu vực do backend ghi từ database) và cảnh lời mời.
 */

/** Độ dài video được chọn (giây). */
export const VIDEO_DURATIONS = [15, 30, 45, 60] as const;
export type VideoDuration = (typeof VIDEO_DURATIONS)[number];
export const VIDEO_DEFAULT_DURATION: VideoDuration = 30;
/** Mỗi cảnh dài ít nhất chừng này giây để kịp đọc chữ. */
export const VIDEO_MIN_SCENE_SECONDS = 3;
/** Số cảnh ảnh có điểm nổi bật tối đa. */
export const VIDEO_MAX_HIGHLIGHTS = 6;

export type VideoSceneKind = 'INTRO' | 'HIGHLIGHT' | 'FACTS' | 'CTA';

export interface VideoImage {
  id: string;
  url: string;
}

export interface VideoScene {
  kind: VideoSceneKind;
  imageId: string;
  imageUrl: string;
  durationSeconds: number;
  title: string;
  lines: string[];
}

export interface VideoTexts {
  hook: string;
  highlights: string[];
  cta: string;
  facts: string[];
}

/**
 * Cảnh theo thứ tự: mở đầu (ảnh đầu), điểm nổi bật (ảnh kế tiếp, hết ảnh thì quay lại ảnh đầu), thông tin, lời mời.
 * Số cảnh nổi bật bị giới hạn để mỗi cảnh dài ít nhất VIDEO_MIN_SCENE_SECONDS; giây dư dồn cho cảnh thông tin.
 */
export function buildScenes(
  images: readonly VideoImage[],
  durationSeconds: number,
  texts: VideoTexts,
): VideoScene[] {
  if (images.length === 0) {
    throw new Error('Video cần ít nhất một ảnh');
  }
  const highlightCount = Math.max(
    0,
    Math.min(
      texts.highlights.length,
      VIDEO_MAX_HIGHLIGHTS,
      Math.floor(durationSeconds / VIDEO_MIN_SCENE_SECONDS) - 3,
    ),
  );
  const image = (index: number) => images[index % images.length] as VideoImage;
  const scene = (
    kind: VideoSceneKind,
    index: number,
    title: string,
    lines: string[] = [],
  ): Omit<VideoScene, 'durationSeconds'> => ({
    kind,
    imageId: image(index).id,
    imageUrl: image(index).url,
    title,
    lines,
  });
  const scenes = [
    scene('INTRO', 0, texts.hook),
    ...texts.highlights
      .slice(0, highlightCount)
      .map((highlight, index) => scene('HIGHLIGHT', index + 1, highlight)),
    scene('FACTS', highlightCount + 1, 'Thông tin', texts.facts),
    scene('CTA', highlightCount + 2, texts.cta, ['Liên hệ để xem nhà']),
  ];
  const base = Math.floor(durationSeconds / scenes.length);
  const extra = durationSeconds - base * scenes.length;
  return scenes.map((item) => ({
    ...item,
    durationSeconds: base + (item.kind === 'FACTS' ? extra : 0),
  }));
}
