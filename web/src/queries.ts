import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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

export function usePlayerState(guildId: string) {
  return useQuery({
    queryKey: ["player", guildId],
    queryFn: () => api.playerState(guildId),
    enabled: guildId !== "",
    refetchInterval: 3000,
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
