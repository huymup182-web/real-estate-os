import { IsIn, IsOptional } from 'class-validator';

import { VIDEO_DURATIONS, type VideoDuration } from '../video.js';

/** Độ dài video AI (TASK-150); bỏ trống là 30 giây. */
export class AiVideoDto {
  @IsOptional()
  @IsIn(VIDEO_DURATIONS, {
    message: `durationSeconds phải là một trong: ${VIDEO_DURATIONS.join(', ')}`,
  })
  durationSeconds?: VideoDuration;
}
