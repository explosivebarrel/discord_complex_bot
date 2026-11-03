import type { MutableRefObject } from "react";
import type { FavoriteTrackInfo, TrackInfo, UserPlaylistBrief } from "../../api";

/** Body of api.enqueue: query/encoded + source + optional metadata. */
export type EnqueueBody = {
  query?: string;
  encoded?: string;
  source?: string;
  title?: string;
  author?: string;
  length_ms?: number;
  artwork?: string | null;
};

export interface SourceChip {
  id: string;
  label: string;
  icon: React.ReactNode;
}

/** Everything the sticky search bar needs. */
export interface SearchBarProps {
  gid: string;
  source: string;
  setSource: (s: string) => void;
  query: string;
  setQuery: (q: string) => void;
  hasQuery: boolean;
  searchActive: boolean;
  setSearchActive: (v: boolean) => void;
  setResults: (r: TrackInfo[] | null) => void;
  setSearching: (v: boolean) => void;
  searching: boolean;
  enqueueing: string | null;
  enqueue: (key: string, body: EnqueueBody) => void;
  doSearch: () => void;
  sourceAvailable: (id: string) => boolean;
  uploading: string | null;
  fileInputRef: MutableRefObject<HTMLInputElement | null>;
  uploadFiles: (files: FileList | null) => void;
  onPreset: (preset: string) => void;
  guard: (e: Error) => void;
  SOURCES: SourceChip[];
  PLACEHOLDERS: Record<string, string>;
  RADIO_PRESETS: string[];
  UPLOAD_ACCEPT: string;
}

/** The player home: search on top, the home rails under it. */
export interface SearchTabProps extends SearchBarProps {
  results: TrackInfo[] | null;
  favorites: FavoriteTrackInfo[];
  played: TrackInfo[];
  myPls: UserPlaylistBrief[];
  toggleFavorite: (t: TrackInfo) => void;
  onOpenCollection: (plId: number) => void;
  onOpenHistory: () => void;
}
