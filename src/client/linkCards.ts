const linkCardHrefPrefix = "secret-wiki-link-card:";

export type LinkCardData = {
  label: string;
  url: string;
  host: string;
};

function parseLinkCardUrl(rawUrl: string) {
  try {
    const url = new URL(rawUrl.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return undefined;
    }
    return url;
  } catch {
    return undefined;
  }
}

function escapeMarkdownLabel(label: string) {
  return label.replace(/\\/g, "\\\\").replace(/\]/g, "\\]");
}

export function linkCardHref(url: string) {
  return `${linkCardHrefPrefix}${encodeURIComponent(url)}`;
}

export function parseLinkCardHref(href?: string): LinkCardData | undefined {
  if (!href?.startsWith(linkCardHrefPrefix)) {
    return undefined;
  }

  const rawUrl = href.slice(linkCardHrefPrefix.length);
  let decodedUrl = "";
  try {
    decodedUrl = decodeURIComponent(rawUrl);
  } catch {
    return undefined;
  }

  const url = parseLinkCardUrl(decodedUrl);
  if (!url) {
    return undefined;
  }

  return {
    label: "",
    url: url.toString(),
    host: url.hostname.replace(/^www\./, "")
  };
}

export function renderLinkCardDirectives(body: string) {
  return body.replace(/^::link-card\[([^\]\r\n]+)\]\(([^)\s]+)\)[^\S\r\n]*$/gm, (match, label: string, rawUrl: string) => {
    const url = parseLinkCardUrl(rawUrl);
    if (!url) {
      return match;
    }
    return `[${escapeMarkdownLabel(label.trim())}](${linkCardHref(url.toString())})`;
  });
}
