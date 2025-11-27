export enum NoteType {
  THOUGHT = 'thought',
  ARTICLE = 'article',
  CHAT = 'chat',
  UNKNOWN = 'unknown'
}

export interface NoteItem {
  id: string;
  content: string;
  type: NoteType;
  title: string;
  summary: string;
  createdAt: number;
  sourceUrl?: string; // Link to original article/video if found
  media?: {
    mimeType: string;
    data: string; // Base64 string
  };
}

export interface ClassificationResult {
  type: NoteType;
  title: string;
  summary: string;
  sourceUrl?: string;
  content?: string; // For returned transcription or image description
}

export enum ViewMode {
  FEED = 'FEED',
  REPORT = 'REPORT'
}