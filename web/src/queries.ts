import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSocketOpen } from "./usePlayerSocket";
import { api, type AccessMockTier } from "./api";

/**
 * Server-state hooks over the plain api client. Pages read loading/error/data
 * from the shared cache instead of hand-rolled useEffect fetches, so a
 * revisit renders instantly from cache while the refresh happens in the
 * background.
 */

export function useMe() {
  return useQuery({ queryKey: ["me"], queryFn: api.me, staleTime: 60_000 });
}

export function useGuilds() {
  return useQuery({ queryKey: ["guilds"], queryFn: api.myGuilds, staleTime: 60_000 });
}

/** Latest availability pass — the shell status chip and the About page. */
export function useSystemStatus() {
  return useQuery({
    queryKey: ["system-status"],
    queryFn: api.systemStatus,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
}

export function useAvailability(range: string) {
  return useQuery({
    queryKey: ["availability", range],
    queryFn: () => api.availability(range),
    refetchInterval: 60_000,
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });
}

/** Super-admin testing override: pretend a tier in one guild. Refreshes the
    guild list and me so the home cards and the sidebar follow at once. */
export function useSetAccessMock() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ guildId, tier }: { guildId: string; tier: AccessMockTier | null }) =>
      api.setAccessMock(guildId, tier),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["guilds"] });
      void qc.invalidateQueries({ queryKey: ["me"] });
    },
  });
}

export function usePlayerPermissions(guildId: string) {
  return useQuery({
    queryKey: ["player-permissions", guildId],
    queryFn: () => api.playerPermissions(guildId),
    enabled: guildId !== "",
    staleTime: 60_000,
  });
}

export function usePlayerState(guildId: string) {
  // The websocket pushes state on change; polling stays as the fallback and
  // as a periodic correction, but slows right down while the socket is open.
  const wsOpen = useSocketOpen(guildId);
  return useQuery({
    queryKey: ["player", guildId],
    queryFn: () => api.playerState(guildId),
    enabled: guildId !== "",
    refetchInterval: wsOpen ? 30000 : 3000,
  });
}

export function useVoiceChannels(guildId: string) {
  return useQuery({
    queryKey: ["channels", guildId],
    queryFn: () => api.voiceChannels(guildId),
    enabled: guildId !== "",
    staleTime: 30_000,
  });
}

export function useGuildUploads(guildId: string) {
  return useQuery({
    queryKey: ["uploads", guildId],
    queryFn: () => api.guildUploads(guildId),
    enabled: guildId !== "",
  });
}

export function useFavorites() {
  return useQuery({ queryKey: ["favorites"], queryFn: api.favorites });
}

export function useMyPlaylists() {
  return useQuery({ queryKey: ["myPlaylists"], queryFn: api.myPlaylists });
}

export function useUserPlaylist(playlistId: number | null) {
  return useQuery({
    queryKey: ["userPlaylist", playlistId],
    queryFn: () => api.userPlaylist(playlistId!),
    enabled: playlistId !== null,
  });
}

export function useGuildStats(guildId: string) {
  return useQuery({
    queryKey: ["stats", guildId],
    queryFn: () => api.guildStats(guildId),
    enabled: guildId !== "",
  });
}

/** Voice-call recordings; live statuses (recording/transcribing) re-poll. */
export function useRecordings(guildId: string) {
  return useQuery({
    queryKey: ["recordings", guildId],
    queryFn: () => api.guildRecordings(guildId),
    enabled: guildId !== "",
    refetchInterval: (query) =>
      query.state.data?.some((r) => r.status === "recording" || r.status === "transcribing")
        ? 4000
        : false,
  });
}

export function useRecordingTranscript(guildId: string, id: number | null) {
  return useQuery({
    queryKey: ["recording-transcript", guildId, id],
    queryFn: () => api.recordingTranscript(guildId, id!),
    enabled: guildId !== "" && id !== null,
  });
}

export function useDeleteRecording(guildId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.deleteRecording(guildId, id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["recordings", guildId] }),
  });
}


export function useGuildSettings(guildId: string) {
  return useQuery({
    queryKey: ["guildSettings", guildId],
    queryFn: () => api.guildSettings(guildId),
    enabled: guildId !== "",
  });
}

export function useModerationUsers(guildId: string) {
  return useQuery({
    queryKey: ["moderationUsers", guildId],
    queryFn: () => api.moderationUsers(guildId),
    enabled: guildId !== "",
  });
}

export function useModerationWarnings(guildId: string) {
  return useQuery({
    queryKey: ["moderationWarnings", guildId],
    queryFn: () => api.moderationWarnings(guildId),
    enabled: guildId !== "",
  });
}

export function useModerationLog(guildId: string) {
  return useQuery({
    queryKey: ["moderationLog", guildId],
    queryFn: () => api.moderationLog(guildId),
    enabled: guildId !== "",
  });
}

export function useIntegrations() {
  return useQuery({ queryKey: ["integrations"], queryFn: api.integrations });
}

export function usePostComposer(guildId: string) {
  return useQuery({
    queryKey: ["postComposer", guildId],
    queryFn: () => api.postComposer(guildId),
    enabled: guildId !== "",
  });
}

export function useAllBotGuilds() {
  return useQuery({ queryKey: ["allBotGuilds"], queryFn: api.allBotGuilds });
}
