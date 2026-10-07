export interface MdContext {
  users: { id: string; name: string }[];
  roles: { id: string; name: string }[];
  channels: { id: string; name: string }[];
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeHtmlAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Render a subset of Discord markdown to HTML for the composer preview:
 * fenced and inline code, bold/italic/underline/strike, headings, quotes,
 * lists, links, autolinks, user/role/channel mentions, @everyone/@here
 * and custom emoji. Input is HTML-escaped before processing.
 */
export function renderDiscordHtml(text: string, ctx: MdContext): string {
  if (!text.trim()) return "";
  let s = esc(text);

  // Fenced code blocks go to placeholders so nothing else touches them.
  const codeBlocks: string[] = [];
  s = s.replace(/```(?:[a-zA-Z0-9+#-]*\n)?([\s\S]*?)```/g, (_m, body: string) => {
    codeBlocks.push(`<pre><code>${body.replace(/\n$/, "")}</code></pre>`);
    return `\x00${codeBlocks.length - 1}\x00`;
  });

  // Inline code, same idea.
  const codeSpans: string[] = [];
  s = s.replace(/`([^`\n]+)`/g, (_m, body: string) => {
    codeSpans.push(`<code>${body}</code>`);
    return `\x01${codeSpans.length - 1}\x01`;
  });

  // Mentions, channels and custom emoji (HTML-escaped angle brackets).
  const userName = new Map(ctx.users.map((u) => [u.id, u.name]));
  const roleName = new Map(ctx.roles.map((r) => [r.id, r.name]));
  const channelName = new Map(ctx.channels.map((c) => [c.id, c.name]));
  s = s
    .replace(/&lt;@!?(\d+)&gt;/g, (_m, id: string) => `<span class="md-mention">@${escapeHtmlAttr(userName.get(id) ?? id)}</span>`)
    .replace(/&lt;@&amp;(\d+)&gt;/g, (_m, id: string) => `<span class="md-mention">@${escapeHtmlAttr(roleName.get(id) ?? id)}</span>`)
    .replace(/&lt;#(\d+)&gt;/g, (_m, id: string) => `<span class="md-mention">#${escapeHtmlAttr(channelName.get(id) ?? id)}</span>`)
    .replace(/&lt;(a?):([a-zA-Z0-9_]+):(\d+)&gt;/g, (_m, animated: string, name: string, id: string) => {
      const ext = animated ? "gif" : "png";
      return `<img class="md-emoji" alt=":${name}:" title=":${name}:" src="https://cdn.discordapp.com/emojis/${id}.${ext}">`;
    })
    .replace(/(^|\s)@(everyone|here)\b/g, '$1<span class="md-mention">@$2</span>');

  // Line-based blocks: headings, quotes, lists.
  const lines = s.split("\n");
  const out: string[] = [];
  let listOpen = false;
  let quoteOpen = false;
  const closeList = () => {
    if (listOpen) {
      out.push("</ul>");
      listOpen = false;
    }
  };
  const closeQuote = () => {
    if (quoteOpen) {
      out.push("</blockquote>");
      quoteOpen = false;
    }
  };
  for (const line of lines) {
    let rest = line;
    let heading = "";
    const headingMatch = /^(#{1,3})\s+(.*)$/.exec(rest);
    if (headingMatch) {
      heading = "h" + String(4 - headingMatch[1].length); // # -> h3, ## -> h4, ### -> h5
      rest = headingMatch[2];
    }
    const isQuote = /^&gt;\s?/.test(rest);
    if (isQuote) rest = rest.replace(/^&gt;\s?/, "");
    const isListItem = /^[-*]\s+/.test(rest);
    if (isListItem) rest = rest.replace(/^[-*]\s+/, "");

    if (heading) {
      closeList();
      closeQuote();
      out.push(`<${heading}>${rest}</${heading}>`);
      continue;
    }
    if (isQuote) {
      closeList();
      if (!quoteOpen) {
        out.push("<blockquote>");
        quoteOpen = true;
      }
      out.push(inline(rest) + "<br>");
      continue;
    }
    closeQuote();
    if (isListItem) {
      if (!listOpen) {
        out.push("<ul>");
        listOpen = true;
      }
      out.push(`<li>${inline(rest)}</li>`);
      continue;
    }
    closeList();
    out.push(inline(rest));
  }
  closeList();
  closeQuote();
  s = out.join("\n");

  // Restore code placeholders (they keep their own newlines).
  s = s.replace(/\x00(\d+)\x00/g, (_m, i: string) => codeBlocks[Number(i)]);
  s = s.replace(/\x01(\d+)\x01/g, (_m, i: string) => codeSpans[Number(i)]);
  return s;
}

function inline(s: string): string {
  let t = s;
  t = t.replace(/\*\*\*([^*]+)\*\*\*/g, "<strong><em>$1</em></strong>");
  t = t.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  t = t.replace(/__([^_]+)__/g, "<u>$1</u>");
  t = t.replace(/~~([^~]+)~~/g, "<s>$1</s>");
  t = t.replace(/\*([^*\n]+)\*/g, "<em>$1</em>");
  t = t.replace(/_([^_\n]+)_/g, "<em>$1</em>");
  t = t.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
  t = t.replace(/(^|[\s(])((?:https?:\/\/)[^\s<]+)/g, '$1<a href="$2" target="_blank" rel="noreferrer">$2</a>');
  return t || "<br>";
}
