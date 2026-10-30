import { type SxProps, type Theme } from "@mui/material";
import { MsIcon } from "./MsIcon";

type IconProps = { fontSize?: number | string; className?: string; sx?: SxProps<Theme> };

// App-wide icon set: every glyph comes from the local Material Symbols
// Rounded subset (https://fonts.google.com/icons), so the whole UI draws
// its icons from one collection. `ic` maps MUI-style props onto MsIcon
// and translates the legacy fontSize="small" to 20px. className must be
// forwarded: MUI clones icon elements with wrapper classes (Chip etc.).
const ic = (name: string, fill = true) => {
  const Component = ({ fontSize = 24, className, sx }: IconProps) => (
    <MsIcon name={name} fontSize={fontSize === "small" ? 20 : fontSize} fill={fill} className={className} sx={sx} />
  );
  return Component;
};

export const IconAddToQueue = ic("add_to_queue");
export const IconAllInclusive = ic("all_inclusive");
export const IconAlternateEmail = ic("alternate_email");
export const IconArrowBack = ic("arrow_back");
export const IconBarChart = ic("bar_chart");
export const IconCancel = ic("cancel");
export const IconCampaign = ic("campaign");
export const IconCheck = ic("check");
export const IconCheckCircle = ic("check_circle");
export const IconClose = ic("close");
export const IconCloud = ic("cloud", false);
export const IconCode = ic("code");
/** Outlined to keep the destructive action light. */
export const IconDelete = ic("delete", false);
export const IconEdit = ic("edit");
export const IconError = ic("error", false);
export const IconFolder = ic("folder");
export const IconFormatBold = ic("format_bold");
export const IconFormatItalic = ic("format_italic");
export const IconFormatListBulleted = ic("format_list_bulleted");
export const IconFormatQuote = ic("format_quote");
export const IconFormatUnderlined = ic("format_underlined");
export const IconForum = ic("forum");
export const IconGavel = ic("gavel");
export const IconGraphicEq = ic("graphic_eq");
/** Outlined: "not configured" state in status lists. */
export const IconHelp = ic("help", false);
export const IconHistory = ic("history");
export const IconInfo = ic("info", false);
export const IconKeyboardArrowDown = ic("keyboard_arrow_down");
export const IconKeyboardArrowUp = ic("keyboard_arrow_up");
export const IconLibraryMusic = ic("library_music");
export const IconLink = ic("link");
export const IconLogout = ic("logout");
export const IconUpload = ic("upload", false);
export const IconMenu = ic("menu");
export const IconMood = ic("mood");
export const IconMusicNote = ic("music_note");
export const IconPalette = ic("palette");
export const IconPause = ic("pause");
export const IconPlayArrow = ic("play_arrow");
export const IconPlayCircle = ic("play_circle");
export const IconPlaylistAdd = ic("playlist_add");
export const IconPostAdd = ic("post_add");
export const IconQueueMusic = ic("queue_music");
export const IconRadio = ic("radio");
export const IconRepeat = ic("repeat");
export const IconRepeatOne = ic("repeat_one");
export const IconSearch = ic("search");
export const IconSettings = ic("settings");
export const IconShuffle = ic("shuffle");
export const IconSkipNext = ic("skip_next");
export const IconSkipPrevious = ic("skip_previous");
export const IconStop = ic("stop");
export const IconStrikethrough = ic("strikethrough_s");
/** Outlined like the previous Tag glyph. */
export const IconTag = ic("tag", false);
/** Advanced-theme settings trigger. */
export const IconTune = ic("tune");
export const IconTitle = ic("title");
export const IconVisibility = ic("visibility");
export const IconVolumeUp = ic("volume_up");
export const IconWorkspaces = ic("workspaces");

/** Heart: filled marks the favorite state, outlined the opposite. */
export const IconFavorite = ({
  filled = true,
  fontSize = 24,
  className,
  sx,
}: IconProps & { filled?: boolean }) => (
  <MsIcon
    name="favorite"
    fontSize={fontSize === "small" ? 20 : fontSize}
    fill={filled}
    className={className}
    sx={sx}
  />
);
