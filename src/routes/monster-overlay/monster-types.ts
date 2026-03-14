import type { TextBuffDisplay } from "../game-overlay/overlay-types";

export type MonsterBossBuffSection = {
  bossUid: number;
  title: string;
  rows: TextBuffDisplay[];
  isPlaceholder?: boolean;
};

export type MonsterHateSection = {
  bossUid: number;
  title: string;
  rows: TextBuffDisplay[];
  isPlaceholder?: boolean;
};

export type MonsterDragTarget =
  | { kind: "buffPanel" }
  | { kind: "hatePanel" };

export type MonsterResizeTarget =
  | { kind: "buffPanel" }
  | { kind: "hatePanel" };

export type MonsterDragState = {
  target: MonsterDragTarget;
  startX: number;
  startY: number;
  startPos: { x: number; y: number };
};

export type MonsterResizeState = {
  target: MonsterResizeTarget;
  startX: number;
  startY: number;
  startValue: number;
};

export type GhostArea = {
  id: string;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  scale: number;
};
