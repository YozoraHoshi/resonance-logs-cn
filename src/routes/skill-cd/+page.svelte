<script lang="ts">
  import { onMount } from "svelte";
  import {
    onBuffUpdate,
    onSkillCdUpdate,
    onFightResUpdate,
    type BuffUpdateState,
    type SkillCdState,
  } from "$lib/api";
  import { getCurrentWindow, PhysicalSize } from "@tauri-apps/api/window";
  import { SETTINGS } from "$lib/settings-store";
  import {
    findSkillDerivationBySource,
    findAnySkillByBaseId,
    findResourcesByClass,
  } from "$lib/skill-mappings";

  type SkillDisplay = {
    isActive: boolean;
    percent: number;
    text: string;
    chargesText?: string;
  };

  let cdMap = $state(new Map<number, SkillCdState>());
  let displayMap = $state(new Map<number, SkillDisplay>());
  let fightResValues = $state<number[]>([]);
  let buffMap = $state(new Map<number, BuffUpdateState>());
  let activeBuffIds = $state(new Set<number>());
  let buffDurationPercents = $state(new Map<number, number>());
  let rafId: number | null = null;

  const RESOURCE_SCALES: Record<number, number> = {
    4: 100,
    5: 100,
  };
  const DEFAULT_RESOURCE_VALUES_BY_CLASS: Record<string, Record<number, number>> = {
    wind_knight: {
      4: 130,
      5: 130,
      6: 6,
      7: 6,
    },
    frost_mage: {
      4: 0,
      5: 125,
      6: 0,
      7: 4,
    },
  };

  const activeProfile = $derived.by(() => {
    const profiles = SETTINGS.skillMonitor.state.profiles;
    if (profiles.length === 0) return null;
    const index = Math.min(
      Math.max(SETTINGS.skillMonitor.state.activeProfileIndex, 0),
      profiles.length - 1,
    );
    return profiles[index];
  });
  const selectedClassKey = $derived(activeProfile?.selectedClass ?? "wind_knight");
  const monitoredSkillIds = $derived(activeProfile?.monitoredSkillIds ?? []);

  function computeDisplay(
    skillId: number,
    cd: SkillCdState,
    now: number,
  ): SkillDisplay | null {
    const skill = findAnySkillByBaseId(selectedClassKey, skillId);
    const cdAccelerateRate = Math.max(0, cd.cdAccelerateRate ?? 0);
    const elapsed = Math.max(0, now - cd.receivedAt);
    const baseDuration = cd.duration > 0 ? Math.max(1, cd.duration) : 1;
    const reducedDuration = cd.duration > 0 ? Math.max(0, cd.calculatedDuration) : 0;
    const validCdScale = cd.duration > 0 ? reducedDuration / baseDuration : 1;
    const scaledValidCdTime = cd.validCdTime * validCdScale;
    const progressed = scaledValidCdTime + elapsed * (1 + cdAccelerateRate);

    if (cd.duration === -1 && cd.skillCdType === 1) {
      if (!skill?.maxValidCdTime) return null;
      const chargePercent = Math.max(
        0,
        Math.min(1, cd.validCdTime / skill.maxValidCdTime),
      );
      return {
        isActive: chargePercent < 1,
        percent: 1 - chargePercent,
        text: `${Math.round(chargePercent * 100)}%`,
      };
    }

    if (cd.skillCdType === 1 && cd.duration > 0) {
      const maxCharges = Math.max(1, skill?.maxCharges ?? 1);
      if (maxCharges > 1) {
        const chargeDuration = Math.max(1, cd.calculatedDuration);
        const maxVct = maxCharges * chargeDuration;
        const currentVct = Math.min(maxVct, progressed);
        const chargesAvailable = Math.min(
          maxCharges,
          Math.floor(currentVct / chargeDuration),
        );
        const chargesOnCd = Math.max(0, maxCharges - chargesAvailable);
        if (chargesOnCd <= 0) {
          return {
            isActive: false,
            percent: 0,
            text: "",
            chargesText: `${maxCharges}/${maxCharges}`,
          };
        }
        const timeToNextCharge = Math.max(
          0,
          chargeDuration - (currentVct % chargeDuration),
        );
        const percent = Math.min(1, timeToNextCharge / chargeDuration);
        return {
          isActive: chargesOnCd > 0,
          percent,
          text: (timeToNextCharge / 1000).toFixed(1),
          chargesText: `${chargesAvailable}/${maxCharges}`,
        };
      }
    }

    const remaining = reducedDuration > 0 ? Math.max(0, reducedDuration - progressed) : 0;
    const duration = reducedDuration > 0 ? reducedDuration : 1;
    const percent = remaining > 0 ? Math.min(1, remaining / duration) : 0;
    return {
      isActive: remaining > 0,
      percent,
      text: remaining > 0 ? (remaining / 1000).toFixed(1) : "",
    };
  }

  function getResourceValue(index: number): number {
    const raw = fightResValues[index];
    if (raw === undefined) {
      return DEFAULT_RESOURCE_VALUES_BY_CLASS[selectedClassKey]?.[index] ?? 0;
    }
    const scale = RESOURCE_SCALES[index] ?? 1;
    return Math.floor(raw / scale);
  }

  function getResourcePreciseValue(index: number): number {
    const raw = fightResValues[index];
    if (raw === undefined) {
      return DEFAULT_RESOURCE_VALUES_BY_CLASS[selectedClassKey]?.[index] ?? 0;
    }
    const scale = RESOURCE_SCALES[index] ?? 1;
    return raw / scale;
  }

  function updateDisplay() {
    const now = Date.now();
    const nextActiveBuffIds = new Set<number>();
    const nextBuffDurationPercents = new Map<number, number>();
    for (const [baseId, buff] of buffMap) {
      const end = buff.createTimeMs + buff.durationMs;
      if (buff.durationMs > 0) {
        const remaining = Math.max(0, end - now);
        const percent = Math.min(100, Math.max(0, (remaining / buff.durationMs) * 100));
        nextBuffDurationPercents.set(baseId, percent);
      }
      if (buff.durationMs <= 0 || end > now) {
        nextActiveBuffIds.add(baseId);
      }
    }
    activeBuffIds = nextActiveBuffIds;
    buffDurationPercents = nextBuffDurationPercents;

    const next = new Map<number, SkillDisplay>();
    for (const [skillId, cd] of cdMap) {
      const display = computeDisplay(skillId, cd, now);
      if (display) {
        next.set(skillId, display);
      }
    }
    displayMap = next;

    rafId = requestAnimationFrame(updateDisplay);
  }

  onMount(() => {
    // Force transparent background for overlay window.
    if (typeof document !== "undefined") {
      document.documentElement.style.setProperty(
        "background",
        "transparent",
        "important",
      );
      document.body.style.setProperty(
        "background",
        "transparent",
        "important",
      );
    }

    void (async () => {
      try {
        const win = getCurrentWindow();
        const size = await win.innerSize();
        await win.setSize(new PhysicalSize(size.width + 1, size.height + 1));
        await win.setSize(new PhysicalSize(size.width, size.height));
      } catch (error) {
        console.warn("[skill-cd] resize hack failed", error);
      }
    })();

    const unlistenBuff = onBuffUpdate((event) => {
      const next = new Map<number, BuffUpdateState>();
      for (const buff of event.payload.buffs) {
        const existing = next.get(buff.baseId);
        if (!existing || buff.createTimeMs >= existing.createTimeMs) {
          next.set(buff.baseId, buff);
        }
      }
      buffMap = next;
    });

    const unlisten = onSkillCdUpdate((event) => {
      for (const cd of event.payload.skillCds) {
        const baseId = Math.floor(cd.skillLevelId / 100);
        cdMap.set(baseId, cd);
      }
    });

    const unlistenRes = onFightResUpdate((event) => {
      console.log("[skill-cd] fight-res-update", event.payload);
      fightResValues = event.payload.fightRes.values;
    });

    rafId = requestAnimationFrame(updateDisplay);

    return () => {
      unlistenBuff.then((fn) => fn());
      unlisten.then((fn) => fn());
      unlistenRes.then((fn) => fn());
      if (rafId) cancelAnimationFrame(rafId);
    };
  });

</script>

<div class="skill-cd-root" data-tauri-drag-region>
  <div class="skill-cd-grid">
    {#each Array(10) as _, idx (idx)}
      {@const skillId = monitoredSkillIds[idx]}
      {@const display = skillId ? displayMap.get(skillId) : undefined}
      {@const skill = skillId
        ? findAnySkillByBaseId(selectedClassKey, skillId)
        : undefined}
      {@const derivation = skillId
        ? findSkillDerivationBySource(selectedClassKey, skillId)
        : undefined}
      {@const isDerivedActive = derivation
        ? activeBuffIds.has(derivation.triggerBuffBaseId)
        : false}
      {@const displaySkill =
        isDerivedActive && derivation
          ? { name: derivation.derivedName, imagePath: derivation.derivedImagePath }
          : skill}
      {@const effectiveDisplay = (isDerivedActive && !derivation?.keepCdWhenDerived) ? undefined : display}
      {@const resourceBlocked = skill?.resourceRequirement
        ? getResourceValue(skill.resourceRequirement.resourceIndex) <
          skill.resourceRequirement.amount
        : false}
      {@const isOnCd = effectiveDisplay?.isActive ?? false}
      {@const isUnavailable = isOnCd || resourceBlocked}
      {@const percent = isOnCd ? effectiveDisplay?.percent ?? 0 : 0}
      {@const displayText = effectiveDisplay?.text ?? ""}
      <div
        class="skill-cell"
        class:empty={!skillId}
        class:on-cd={isOnCd}
        class:derived-active={isDerivedActive}
      >
        {#if displaySkill?.imagePath}
          <img
            src={displaySkill.imagePath}
            alt={displaySkill.name}
            class="skill-icon"
            class:dimmed={isUnavailable}
          />
        {:else if skillId}
          <div class="skill-fallback">#{skillId}</div>
        {/if}

        {#if effectiveDisplay?.chargesText}
          <div class="charges-badge">{effectiveDisplay.chargesText}</div>
        {/if}

        {#if isOnCd}
          <div class="cd-overlay" style={`--cd-percent: ${percent}`}>
            {#if displayText}
              <span class="cd-text">{displayText}</span>
            {/if}
          </div>
        {/if}
      </div>
    {/each}
  </div>

  <div class="resources-panel" data-class={selectedClassKey}>
    <div class="resources-row energy-row">
      {#each findResourcesByClass(selectedClassKey).filter((res) => res.type === "bar") as res}
        {@const cur = getResourceValue(res.currentIndex)}
        {@const max = Math.max(1, getResourceValue(res.maxIndex))}
        {@const curPrecise = getResourcePreciseValue(res.currentIndex)}
        {@const maxPrecise = Math.max(1, getResourcePreciseValue(res.maxIndex))}
        {@const energyPercent = Math.min(
          100,
          Math.max(0, (curPrecise / maxPrecise) * 100),
        )}
        {@const buffPercent = res.buffBaseId
          ? (buffDurationPercents.get(res.buffBaseId) ?? 0)
          : energyPercent}
        <div class="res-bar-container">
          <img src={res.imageOff} alt={res.label} class="res-bar-bg" />
          <div
            class="res-bar-fill-mask"
            style:clip-path={`inset(0 ${100 - buffPercent}% 0 0)`}
          >
            <img src={res.imageOn} alt={res.label} class="res-bar-fill" />
          </div>
          <div class="res-energy-overlay">
            <div class="res-energy-track">
              <div class="res-energy-fill" style:width={`${energyPercent}%`}></div>
            </div>
          </div>
          <div class="res-text">{cur}/{max}</div>
        </div>
      {/each}
    </div>

    <div class="resources-row sharpness-row">
      {#each findResourcesByClass(selectedClassKey).filter((res) => res.type === "charges") as res}
        {@const cur = getResourceValue(res.currentIndex)}
        {@const max = Math.max(1, getResourceValue(res.maxIndex))}
        <div class="res-charges-container">
          {#each Array(max) as _, i}
            <img
              src={i < cur ? res.imageOn : res.imageOff}
              alt={res.label}
              class="res-charge-icon"
            />
          {/each}
        </div>
      {/each}
    </div>
  </div>
</div>

<style>
  .skill-cd-root {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 6px;
    border-radius: 8px;
    background: transparent;
    user-select: none;
    align-items: center; /* Center resources */
  }

  .resources-panel {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    margin-top: 2px;
  }

  .resources-row {
    display: flex;
    flex-direction: row;
    align-items: center;
    justify-content: center;
    gap: 12px;
  }

  .sharpness-row {
    margin-top: -2px;
  }

  .resources-panel[data-class="frost_mage"] {
    transform: scale(1.5);
    transform-origin: center;
  }

  /* Resource Bar (Energy) */
  .res-bar-container {
    position: relative;
    margin-top: 14px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .res-bar-bg {
    display: block;
    height: 40px;
    width: auto;
  }

  .res-bar-fill-mask {
    position: absolute;
    inset: 0;
    will-change: clip-path;
    pointer-events: none;
  }

  .res-energy-overlay {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    padding: 0 43px 0 29px;
    pointer-events: none;
  }

  .res-bar-fill {
    display: block;
    height: 40px;
    width: auto;
  }

  .res-energy-track {
    width: 100%;
    height: 5px;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.18);
    overflow: hidden;
  }

  .res-energy-fill {
    height: 100%;
    border-radius: 999px;
    background: #ffffff;
    box-shadow: 0 0 4px rgba(255, 255, 255, 0.5);
    transition: width 100ms linear;
    will-change: width;
  }

  .res-text {
    position: absolute;
    top: -17px;
    left: 0;
    font-size: 14px;
    font-weight: 700;
    color: #ffffff;
    text-shadow: 1px 1px 2px rgba(0, 0, 0, 0.9);
    pointer-events: none;
  }

  /* Resource Charges (Sharpness) */
  .res-charges-container {
    display: flex;
    flex-direction: row;
    gap: -2px; /* Overlap slightly if needed */
  }

  .res-charge-icon {
    height: 24px;
    width: auto;
  }

  .skill-cd-grid {
    display: grid;
    grid-template-columns: repeat(5, 52px);
    grid-template-rows: repeat(2, 52px);
    gap: 6px;
  }

  .skill-cell {
    position: relative;
    width: 52px;
    height: 52px;
    border-radius: 6px;
    overflow: hidden;
    border: 1px solid rgba(255, 255, 255, 0.15);
    background: transparent;
  }

  .skill-cell.empty {
    border-style: dashed;
    border-color: rgba(255, 255, 255, 0.08);
  }

  .skill-cell.derived-active {
    border-color: rgba(255, 216, 102, 0.85);
    box-shadow:
      0 0 8px rgba(255, 216, 102, 0.6),
      0 0 14px rgba(255, 216, 102, 0.35);
  }

  .skill-icon {
    width: 100%;
    height: 100%;
    object-fit: cover;
    pointer-events: none;
  }

  .skill-icon.dimmed {
    filter: grayscale(80%) brightness(0.5);
  }

  .skill-fallback {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 10px;
    color: rgba(255, 255, 255, 0.7);
    pointer-events: none;
  }

  .cd-overlay {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: conic-gradient(
      rgba(0, 0, 0, 0.65) calc(var(--cd-percent) * 360deg),
      transparent calc(var(--cd-percent) * 360deg)
    );
    pointer-events: none;
  }

  .cd-text {
    font-size: 13px;
    font-weight: 600;
    color: #ffffff;
    text-shadow: 0 0 3px rgba(0, 0, 0, 0.9);
    pointer-events: none;
  }

  .charges-badge {
    position: absolute;
    right: 3px;
    bottom: 3px;
    padding: 1px 4px;
    border-radius: 6px;
    background: rgba(0, 0, 0, 0.6);
    color: #ffffff;
    font-size: 9px;
    font-weight: 600;
    line-height: 1;
    pointer-events: none;
  }

  :global(html),
  :global(body) {
    background: transparent !important;
  }
</style>
