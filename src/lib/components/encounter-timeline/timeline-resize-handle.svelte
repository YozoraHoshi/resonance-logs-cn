<script lang="ts">
  // Thin horizontal hit target stacked above the timeline gesture surface.
  // Owns its own pointer capture so lane/curve resize never starts a brush.
  type Props = {
    ariaLabel: string;
    onDragStart: (clientY: number) => void;
    onDrag: (clientY: number) => void;
    onDragEnd: () => void;
    onReset: () => void;
  };

  let { ariaLabel, onDragStart, onDrag, onDragEnd, onReset }: Props = $props();

  let dragging = $state(false);

  function targetElement(event: PointerEvent): HTMLElement | null {
    return event.currentTarget instanceof HTMLElement
      ? event.currentTarget
      : null;
  }

  function onPointerDown(event: PointerEvent) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    dragging = true;
    targetElement(event)?.setPointerCapture(event.pointerId);
    onDragStart(event.clientY);
  }

  function onPointerMove(event: PointerEvent) {
    if (!dragging) return;
    event.preventDefault();
    onDrag(event.clientY);
  }

  function endDrag(event: PointerEvent) {
    if (!dragging) return;
    dragging = false;
    const node = targetElement(event);
    if (node?.hasPointerCapture(event.pointerId)) {
      node.releasePointerCapture(event.pointerId);
    }
    onDragEnd();
  }

  function onDblClick(event: MouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    onReset();
  }
</script>

<div
  class="tl-resize"
  class:tl-resize-active={dragging}
  role="separator"
  aria-orientation="horizontal"
  aria-label={ariaLabel}
  onpointerdown={onPointerDown}
  onpointermove={onPointerMove}
  onpointerup={endDrag}
  onpointercancel={endDrag}
  ondblclick={onDblClick}
></div>

<style>
  .tl-resize {
    position: absolute;
    inset: 0;
    z-index: 5;
    cursor: ns-resize;
    touch-action: none;
  }

  .tl-resize::after {
    content: "";
    position: absolute;
    top: 50%;
    right: 12%;
    left: 12%;
    height: 2px;
    border-radius: 1px;
    background: rgba(148, 163, 184, 0.35);
    transform: translateY(-50%);
  }

  .tl-resize:hover::after,
  .tl-resize-active::after {
    background: rgba(96, 165, 250, 0.85);
  }
</style>
