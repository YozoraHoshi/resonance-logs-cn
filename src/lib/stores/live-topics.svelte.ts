import { commands, type LiveBuffsPayload, type LiveCombatPayload, type LiveFantasyPayload, type LiveMonsterPayload, type LiveStatusPayload } from "$lib/bindings";
import { LiveTopicStore } from "$lib/stores/live-topic-store.svelte";

export const liveCombatStore = new LiveTopicStore<LiveCombatPayload>(
  "live-combat",
  () => commands.getLiveCombat(),
);

export const liveStatusStore = new LiveTopicStore<LiveStatusPayload>(
  "live-status",
  () => commands.getLiveStatus(),
);

export const liveBuffsStore = new LiveTopicStore<LiveBuffsPayload>(
  "live-buffs",
  () => commands.getLiveBuffs(),
);

export const liveMonsterStore = new LiveTopicStore<LiveMonsterPayload>(
  "live-monster",
  () => commands.getLiveMonster(),
);

export const liveFantasyStore = new LiveTopicStore<LiveFantasyPayload>(
  "live-fantasy",
  () => commands.getLiveFantasy(),
);
