<script lang="ts">
  let {
    value = $bindable(""),
    placeholder = "",
    ariaLabel,
    resetLabel,
  }: {
    value?: string;
    placeholder?: string;
    ariaLabel: string;
    resetLabel: string;
  } = $props();
</script>

<div class="flex w-44 shrink-0 items-center gap-1.5">
  <input
    type="text"
    bind:value
    {placeholder}
    aria-label={ariaLabel}
    title={value.trim() || placeholder}
    maxlength={32}
    class="border-border bg-popover placeholder:text-muted-foreground/50 focus:border-primary focus:ring-primary/40 min-w-0 flex-1 rounded-md border px-2.5 py-1.5 text-sm transition-colors focus:ring-2 focus:outline-none"
  />
  <button
    type="button"
    class="border-border text-muted-foreground hover:bg-muted/50 hover:text-foreground size-8 shrink-0 rounded-md border text-base transition-colors disabled:cursor-default disabled:opacity-30"
    aria-label={resetLabel}
    title={resetLabel}
    disabled={!value}
    onclick={() => {
      value = "";
    }}
  >
    ×
  </button>
</div>
