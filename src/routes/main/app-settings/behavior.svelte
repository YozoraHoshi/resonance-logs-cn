<script lang="ts">
  import { t } from "$lib/i18n/index.svelte";
  import { SETTINGS } from "$lib/settings-store";
  import SettingsSwitch from "../dps/settings/settings-switch.svelte";
</script>

<div class="space-y-3">
  <div
    class="border-border/60 bg-card/40 overflow-hidden rounded-lg border shadow-[inset_0_1px_0_0_rgba(255,255,255,0.02)]"
  >
    <div class="px-4 py-3">
      <h2 class="text-foreground mb-1 text-base font-semibold">
        {t("appSettings.behavior.title")}
      </h2>
      <SettingsSwitch
        label={t("appSettings.behavior.exitOnClose")}
        description={t("appSettings.behavior.exitOnCloseDescription")}
        bind:checked={SETTINGS.accessibility.state.exitOnClose}
      />
    </div>
  </div>
</div>
