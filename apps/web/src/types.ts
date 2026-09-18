export type MovieStatus =
  | 'discovered'
  | 'queued'
  | 'processing'
  | 'partial'
  | 'ready'
  | 'failed';

export interface PublicMovie {
  id: string;
  title: string;
  filename: string;
  status: MovieStatus;
  sourceAvailable: boolean;
  sizeBytes: number;
  durationSeconds?: number;
  width?: number;
  height?: number;
  videoCodec?: string;
  audioCodec?: string;
  createdAt: string;
  updatedAt: string;
  playUrl: string;
  transcodingProgress?: number;
  transcodingProfile?: string;
  completedProfiles?: string[];
  error?: string;
}

export interface SubtitleTrack {
  index: number;
  language: string;
  title?: string;
  isForced?: boolean;
}
