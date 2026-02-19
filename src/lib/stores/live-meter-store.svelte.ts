import type { DungeonLog, LiveDataPayload } from "$lib/api";

let liveData = $state<LiveDataPayload | null>(null);
let liveDungeonLog = $state<DungeonLog | null>(null);

export function setLiveData(data: LiveDataPayload) {
  liveData = data;
}

export function getLiveData() {
  return liveData;
}

export function clearLiveData() {
  liveData = null;
}

export function setLiveDungeonLog(log: DungeonLog | null) {
  liveDungeonLog = log;
}

export function getLiveDungeonLog() {
  return liveDungeonLog;
}

export function clearLiveDungeonLog() {
  liveDungeonLog = null;
}

export function clearMeterData() {
  clearLiveData();
}

export function cleanupStores() {
  clearLiveData();
  clearLiveDungeonLog();
}
