<script lang="ts">
  import SkillDurationCell from "./SkillDurationCell.svelte";
  import {
    getSkillDurationPosition,
    getSkillDurationSize,
    isEditing,
    skillDurationDisplays,
    startDrag,
    startResize,
  } from "./overlay-state.svelte.js";

  const editing = $derived(isEditing());
  const displays = $derived(skillDurationDisplays());
</script>

{#each displays as skill, idx (skill.skillId)}
  {@const iconPos = getSkillDurationPosition(skill.skillId, idx)}
  {@const iconSize = getSkillDurationSize(skill.skillId)}
  <SkillDurationCell
    {skill}
    {iconSize}
    editable={editing}
    left={iconPos.x}
    top={iconPos.y}
    onPointerDown={(e) =>
      startDrag(e, { kind: "skillDuration", skillId: skill.skillId }, iconPos)}
    onResizePointerDown={(e) =>
      startResize(e, { kind: "skillDuration", skillId: skill.skillId }, iconSize)}
  />
{/each}
