const DEFAULT_SANS = '"Inter Variable", sans-serif';
const DEFAULT_MONO = '"Geist Mono Variable", monospace';

type FontKind = "sans" | "mono";

export type CustomFontSettings = {
  sansEnabled: boolean;
  sansName: string;
  sansUrl: string;
  monoEnabled: boolean;
  monoName: string;
  monoUrl: string;
};

const pendingFontLoads = new Map<string, Promise<void>>();
const resolvedFontFamilies = new Map<string, string>();

function getFontVarName(kind: FontKind) {
  return kind === "sans" ? "--font-sans" : "--font-mono";
}

function getDefaultFontValue(kind: FontKind) {
  return kind === "sans" ? DEFAULT_SANS : DEFAULT_MONO;
}

function getFallbackFamily(kind: FontKind) {
  return kind === "sans" ? "sans-serif" : "monospace";
}

function hashString(value: string) {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

function createRuntimeFamily(kind: FontKind, name: string, url: string) {
  return `rlcn-${kind}-${name}-${hashString(url)}`;
}

async function loadAndApplyFont(
  kind: FontKind,
  enabled: boolean,
  name: string,
  url: string,
) {
  const fontVar = getFontVarName(kind);
  const defaultValue = getDefaultFontValue(kind);
  const fallback = getFallbackFamily(kind);

  if (!enabled || !name || !url) {
    document.documentElement.style.setProperty(fontVar, defaultValue);
    return;
  }

  const cacheKey = `${kind}::${name}::${url}`;
  const runtimeFamily =
    resolvedFontFamilies.get(cacheKey) ?? createRuntimeFamily(kind, name, url);

  let pending = pendingFontLoads.get(cacheKey);
  if (!pending) {
    pending = new FontFace(runtimeFamily, `url(${url})`)
      .load()
      .then((loadedFace) => {
        document.fonts.add(loadedFace);
        resolvedFontFamilies.set(cacheKey, runtimeFamily);
      });
    pendingFontLoads.set(cacheKey, pending);
  }

  try {
    await pending;
  } catch (error) {
    console.warn(`[font-loader] failed to load ${kind} font "${name}"`, error);
    pendingFontLoads.delete(cacheKey);
    resolvedFontFamilies.delete(cacheKey);
    document.documentElement.style.setProperty(fontVar, `"${name}", ${fallback}`);
    return;
  }

  document.documentElement.style.setProperty(
    fontVar,
    `"${runtimeFamily}", "${name}", ${fallback}`,
  );
}

export function applyCustomFonts(settings: CustomFontSettings) {
  if (typeof document === "undefined") return;

  void loadAndApplyFont(
    "sans",
    settings.sansEnabled,
    settings.sansName,
    settings.sansUrl,
  );
  void loadAndApplyFont(
    "mono",
    settings.monoEnabled,
    settings.monoName,
    settings.monoUrl,
  );
}
