import { getLocale } from "$lib/i18n/index.svelte";

const CLASS_LABELS_EN: Record<string, string> = {
  "Flame Berserker": "Twin Striker",
};

const CLASS_LABELS_ZH: Record<string, string> = {
  "Heavy Guardian": "巨刃守护者",
  "Shield Knight": "神盾骑士",
  Stormblade: "雷影剑士",
  "Wind Knight": "青岚骑士",
  Marksman: "神射手",
  "Frost Mage": "冰魔导师",
  "Flame Berserker": "赤炎狂战士",
  "Verdant Oracle": "森语者",
  "Beat Performer": "灵魂乐手",
};

const CLASS_LABELS_JA: Record<string, string> = {
  "Heavy Guardian": "ヘヴィガーディアン",
  "Shield Knight": "シールドファイター",
  Stormblade: "ストームブレイド",
  "Wind Knight": "ゲイルランサー",
  Marksman: "ディバインアーチャー",
  "Frost Mage": "フロストメイジ",
  "Flame Berserker": "ツインストライカー",
  "Verdant Oracle": "ヴァーダントオラクル",
  "Beat Performer": "ビートパフォーマー",
};

const SPEC_LABELS_EN: Record<string, string> = {
  Voidflame: "Formless",
  Blazecrimson: "Crimson",
};

const SPEC_LABELS_ZH: Record<string, string> = {
  Earthfort: "岩盾",
  Block: "格挡",
  Iaido: "太刀",
  "Iaido Slash": "太刀",
  Moonstrike: "月刃",
  Vanguard: "重装",
  Skyward: "空枪",
  Wildpack: "狼弓",
  Falconry: "鹰弓",
  Icicle: "冰矛",
  Frostbeam: "射线",
  Voidflame: "无相流",
  Blazecrimson: "赤红流",
  Smite: "惩击",
  Lifebind: "愈合",
  Recovery: "防盾",
  Shield: "光盾",
  "Light Shield": "光盾",
  Concerto: "协奏",
  Dissonance: "狂音",
};

const SPEC_LABELS_JA: Record<string, string> = {
  Earthfort: "剛身型",
  Block: "剛守型",
  Iaido: "雷刃型",
  "Iaido Slash": "雷刃型",
  Moonstrike: "月影型",
  Vanguard: "烈風型",
  Skyward: "乱風型",
  Wildpack: "狼弓型",
  Falconry: "鷹弓型",
  Icicle: "氷牙型",
  Frostbeam: "霜天型",
  Voidflame: "双炎型",
  Blazecrimson: "炎舞型",
  Smite: "威咲型",
  Lifebind: "森癒型",
  Recovery: "光砕型",
  Shield: "光盾型",
  "Light Shield": "光盾型",
  Concerto: "響奏型",
  Dissonance: "狂音型",
};

function getClassLabelMap() {
  const locale = getLocale();
  if (locale === "en-US") return CLASS_LABELS_EN;
  if (locale === "zh-CN") return CLASS_LABELS_ZH;
  if (locale === "ja-JP") return CLASS_LABELS_JA;
  return null;
}

function getSpecLabelMap() {
  const locale = getLocale();
  if (locale === "en-US") return SPEC_LABELS_EN;
  if (locale === "zh-CN") return SPEC_LABELS_ZH;
  if (locale === "ja-JP") return SPEC_LABELS_JA;
  return null;
}

export function toClassLabel(className: string): string {
  const labels = getClassLabelMap();
  if (!labels) return className;
  return labels[className] ?? className;
}

export function toSpecLabel(specName: string): string {
  const labels = getSpecLabelMap();
  if (!labels) return specName;
  return labels[specName] ?? specName;
}

export function formatClassSpecLabel(
  className: string,
  specName?: string,
): string {
  const classLabel = toClassLabel(className);
  const specLabel = specName ? toSpecLabel(specName) : "";
  if (!classLabel && !specLabel) return "";
  if (!classLabel) return specLabel;
  if (!specLabel) return classLabel;
  return `${classLabel} - ${specLabel}`;
}
