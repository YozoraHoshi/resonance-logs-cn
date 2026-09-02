//! Shared active-combat-window rule and local-player buff coverage.
//!
//! [`CombatProjection`](crate::live::projections::combat::projection::CombatProjection)
//! is the sole owner of the active clock. It emits an [`ActiveWindowAdvance`]
//! for every accepted player-damage hit; consumers apply that exact advance
//! instead of independently reconstructing hit gaps.

use std::collections::HashMap;

pub const INACTIVITY_CUTOFF_MS: u64 = 3_000;
pub const HIT_GRACE_MS: u64 = 500;

/// One authoritative increment of the active-combat clock.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ActiveWindowAdvance {
    /// The complete interval between two nearby player-damage hits is active.
    FullGap {
        start_offset_ms: u64,
        end_offset_ms: u64,
    },
    /// A first hit or a hit after a long inactive gap receives fixed grace.
    Grace { at_offset_ms: u64, credited_ms: u64 },
}

impl ActiveWindowAdvance {
    #[must_use]
    pub const fn credited_ms(self) -> u64 {
        match self {
            Self::FullGap {
                start_offset_ms,
                end_offset_ms,
            } => end_offset_ms.saturating_sub(start_offset_ms),
            Self::Grace { credited_ms, .. } => credited_ms,
        }
    }

    #[must_use]
    pub const fn end_offset_ms(self) -> u64 {
        match self {
            Self::FullGap { end_offset_ms, .. } => end_offset_ms,
            Self::Grace { at_offset_ms, .. } => at_offset_ms,
        }
    }
}

#[must_use]
pub const fn active_window_advance(
    previous_offset_ms: Option<u64>,
    current_offset_ms: u64,
) -> ActiveWindowAdvance {
    let Some(previous_offset_ms) = previous_offset_ms else {
        return ActiveWindowAdvance::Grace {
            at_offset_ms: current_offset_ms,
            credited_ms: HIT_GRACE_MS,
        };
    };
    let delta = current_offset_ms.saturating_sub(previous_offset_ms);
    if delta <= INACTIVITY_CUTOFF_MS {
        ActiveWindowAdvance::FullGap {
            start_offset_ms: previous_offset_ms,
            end_offset_ms: current_offset_ms,
        }
    } else {
        ActiveWindowAdvance::Grace {
            at_offset_ms: current_offset_ms,
            credited_ms: HIT_GRACE_MS,
        }
    }
}

/// Key identifying one local-player coverage row.
pub type CoverageKey = (i64, i32);

#[derive(Debug, Default, Clone)]
struct BuffPresence {
    on_since_ms: Option<u64>,
    expires_hint_ms: Option<u64>,
    /// Closed on-time since the last authoritative hit advance. It remains
    /// provisional until that advance declares the preceding gap active.
    pending_on_ms: u128,
    covered_ms: u128,
    trigger_count: u32,
    active_slot: Option<usize>,
    dirty: bool,
}

/// Coverage accumulator for the local player only.
///
/// Closed historical rows never participate in the hit path. Each advance
/// touches only currently active rows and rows changed since the previous hit.
#[derive(Debug, Default)]
pub struct BuffCoverageTracker {
    anchor_offset_ms: Option<u64>,
    by_key: HashMap<CoverageKey, usize>,
    entries: Vec<BuffPresence>,
    active_indices: Vec<usize>,
    dirty_indices: Vec<usize>,
}

impl BuffCoverageTracker {
    pub fn reset(&mut self) {
        self.anchor_offset_ms = None;
        self.by_key.clear();
        self.entries.clear();
        self.active_indices.clear();
        self.dirty_indices.clear();
    }

    fn ensure_entry(&mut self, key: CoverageKey) -> usize {
        if let Some(index) = self.by_key.get(&key) {
            return *index;
        }
        let index = self.entries.len();
        self.entries.push(BuffPresence::default());
        self.by_key.insert(key, index);
        index
    }

    fn mark_dirty(&mut self, index: usize) {
        if self.entries[index].dirty {
            return;
        }
        self.entries[index].dirty = true;
        self.dirty_indices.push(index);
    }

    fn activate(&mut self, index: usize) {
        if self.entries[index].active_slot.is_some() {
            return;
        }
        let slot = self.active_indices.len();
        self.active_indices.push(index);
        self.entries[index].active_slot = Some(slot);
    }

    fn deactivate(&mut self, index: usize) {
        let Some(slot) = self.entries[index].active_slot.take() else {
            return;
        };
        self.active_indices.swap_remove(slot);
        if let Some(moved) = self.active_indices.get(slot).copied() {
            self.entries[moved].active_slot = Some(slot);
        }
    }

    /// Settles an expiry at or before `at` and returns whether the row closed.
    fn settle_expiry(&mut self, index: usize, at: u64) -> bool {
        let Some(on_since) = self.entries[index].on_since_ms else {
            return false;
        };
        let Some(hint) = self.entries[index].expires_hint_ms else {
            return false;
        };
        if hint > at {
            return false;
        }
        let start = self
            .anchor_offset_ms
            .map_or(on_since, |anchor| on_since.max(anchor));
        if hint > start {
            self.entries[index].pending_on_ms = self.entries[index]
                .pending_on_ms
                .saturating_add(u128::from(hint - start));
        }
        self.entries[index].on_since_ms = None;
        self.entries[index].expires_hint_ms = None;
        self.deactivate(index);
        self.mark_dirty(index);
        true
    }

    pub fn set_on(&mut self, key: CoverageKey, at: u64, expires_hint_ms: Option<u64>) {
        let index = self.ensure_entry(key);
        self.settle_expiry(index, at);
        if self.entries[index].on_since_ms.is_none() {
            self.entries[index].on_since_ms = Some(at);
            self.entries[index].trigger_count = self.entries[index].trigger_count.saturating_add(1);
            self.activate(index);
            self.mark_dirty(index);
        }
        self.entries[index].expires_hint_ms = expires_hint_ms;
    }

    pub fn set_off(&mut self, key: CoverageKey, at: u64) {
        let Some(index) = self.by_key.get(&key).copied() else {
            return;
        };
        self.settle_expiry(index, at);
        if let Some(on_since) = self.entries[index].on_since_ms.take() {
            let start = self
                .anchor_offset_ms
                .map_or(on_since, |anchor| on_since.max(anchor));
            if at > start {
                self.entries[index].pending_on_ms = self.entries[index]
                    .pending_on_ms
                    .saturating_add(u128::from(at - start));
            }
            self.deactivate(index);
            self.mark_dirty(index);
        }
        self.entries[index].expires_hint_ms = None;
    }

    pub fn refresh_hint(&mut self, key: CoverageKey, at: u64, expires_hint_ms: Option<u64>) {
        let index = self.ensure_entry(key);
        self.settle_expiry(index, at);
        if self.entries[index].on_since_ms.is_none() {
            self.entries[index].on_since_ms = Some(at);
            self.entries[index].trigger_count = self.entries[index].trigger_count.saturating_add(1);
            self.activate(index);
            self.mark_dirty(index);
        }
        self.entries[index].expires_hint_ms = expires_hint_ms;
    }

    pub fn apply_advance(&mut self, advance: ActiveWindowAdvance) {
        let at = advance.end_offset_ms();

        // Expiry can remove entries from `active_indices`; use an index loop
        // so swap-remove remains allocation-free on the hit path.
        let mut slot = 0usize;
        while slot < self.active_indices.len() {
            let index = self.active_indices[slot];
            if !self.settle_expiry(index, at) {
                slot += 1;
            }
        }

        match advance {
            ActiveWindowAdvance::FullGap {
                start_offset_ms,
                end_offset_ms,
            } => {
                for &index in &self.active_indices {
                    let presence = &mut self.entries[index];
                    let start = presence
                        .on_since_ms
                        .map_or(end_offset_ms, |on_since| on_since.max(start_offset_ms));
                    let open_ms = end_offset_ms.saturating_sub(start);
                    presence.covered_ms = presence
                        .covered_ms
                        .saturating_add(presence.pending_on_ms)
                        .saturating_add(u128::from(open_ms));
                    presence.pending_on_ms = 0;
                    presence.on_since_ms = Some(end_offset_ms);
                }
                for &index in &self.dirty_indices {
                    let presence = &mut self.entries[index];
                    if presence.active_slot.is_none() {
                        presence.covered_ms =
                            presence.covered_ms.saturating_add(presence.pending_on_ms);
                        presence.pending_on_ms = 0;
                    }
                }
            }
            ActiveWindowAdvance::Grace {
                at_offset_ms,
                credited_ms,
            } => {
                for &index in &self.active_indices {
                    let presence = &mut self.entries[index];
                    presence.covered_ms =
                        presence.covered_ms.saturating_add(u128::from(credited_ms));
                    presence.pending_on_ms = 0;
                    presence.on_since_ms = Some(at_offset_ms);
                }
                for &index in &self.dirty_indices {
                    self.entries[index].pending_on_ms = 0;
                }
            }
        }

        for index in self.dirty_indices.drain(..) {
            self.entries[index].dirty = false;
        }
        self.anchor_offset_ms = Some(at);
    }

    #[must_use]
    pub fn coverage_ms(&self, key: CoverageKey) -> u128 {
        self.by_key
            .get(&key)
            .map_or(0, |index| self.entries[*index].covered_ms)
    }

    #[must_use]
    pub fn trigger_count(&self, key: CoverageKey) -> u32 {
        self.by_key
            .get(&key)
            .map_or(0, |index| self.entries[*index].trigger_count)
    }

    #[must_use]
    pub fn is_on(&self, key: CoverageKey) -> bool {
        self.by_key
            .get(&key)
            .is_some_and(|index| self.entries[*index].on_since_ms.is_some())
    }

    #[cfg(test)]
    #[must_use]
    pub fn hit_path_entry_count(&self) -> usize {
        self.active_indices.len() + self.dirty_indices.len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::hint::black_box;
    use std::time::Instant;

    const KEY: CoverageKey = (10, 1000);

    #[test]
    fn advance_uses_segment_offsets_and_ignores_removed_pause_time() {
        assert_eq!(
            active_window_advance(None, 1_000),
            ActiveWindowAdvance::Grace {
                at_offset_ms: 1_000,
                credited_ms: HIT_GRACE_MS,
            }
        );
        assert_eq!(
            active_window_advance(Some(1_000), 2_000),
            ActiveWindowAdvance::FullGap {
                start_offset_ms: 1_000,
                end_offset_ms: 2_000,
            }
        );
    }

    #[test]
    fn short_gap_counts_full_overlap() {
        let mut tracker = BuffCoverageTracker::default();
        tracker.set_on(KEY, 0, None);
        tracker.apply_advance(active_window_advance(None, 1_000));
        tracker.apply_advance(active_window_advance(Some(1_000), 3_000));
        assert_eq!(tracker.coverage_ms(KEY), 2_500);
    }

    #[test]
    fn off_inside_gap_is_committed_only_when_gap_is_active() {
        let mut tracker = BuffCoverageTracker::default();
        tracker.apply_advance(active_window_advance(None, 1_000));
        tracker.set_on(KEY, 1_200, None);
        tracker.set_off(KEY, 1_800);
        tracker.apply_advance(active_window_advance(Some(1_000), 3_000));
        assert_eq!(tracker.coverage_ms(KEY), 600);
    }

    #[test]
    fn inactive_gap_drops_closed_pending_and_credits_current_state_only() {
        let mut tracker = BuffCoverageTracker::default();
        tracker.apply_advance(active_window_advance(None, 1_000));
        tracker.set_on(KEY, 1_200, None);
        tracker.set_off(KEY, 1_800);
        tracker.apply_advance(active_window_advance(Some(1_000), 10_000));
        assert_eq!(tracker.coverage_ms(KEY), 0);

        tracker.set_on(KEY, 10_500, None);
        tracker.apply_advance(active_window_advance(Some(10_000), 20_000));
        assert_eq!(tracker.coverage_ms(KEY), u128::from(HIT_GRACE_MS));
    }

    #[test]
    fn expiry_is_half_open_at_exact_hit_time() {
        let mut tracker = BuffCoverageTracker::default();
        tracker.set_on(KEY, 0, Some(1_000));
        tracker.apply_advance(active_window_advance(None, 1_000));
        assert_eq!(tracker.coverage_ms(KEY), 0);
        assert!(!tracker.is_on(KEY));
    }

    #[test]
    fn closed_historical_rows_leave_the_hit_path() {
        let mut tracker = BuffCoverageTracker::default();
        for base_id in 1..=1_000 {
            let key = (10, base_id);
            tracker.set_on(key, 0, None);
            tracker.set_off(key, 1);
        }
        tracker.apply_advance(active_window_advance(None, 10));
        assert_eq!(tracker.hit_path_entry_count(), 0);
    }

    #[test]
    #[ignore = "local coverage hot-path benchmark; run explicitly with --ignored --nocapture"]
    fn benchmark_local_coverage_hit_path() {
        fn run(active_rows: usize, seed_closed_rows: bool) -> std::time::Duration {
            let mut tracker = BuffCoverageTracker::default();
            if seed_closed_rows {
                for base_id in 1..=32 {
                    let key = (10, base_id);
                    tracker.set_on(key, 0, None);
                    tracker.set_off(key, 1);
                }
                tracker.apply_advance(active_window_advance(None, 10));
            }
            for base_id in 1..=active_rows as i32 {
                tracker.set_on((10, base_id), 10, None);
            }

            let started = Instant::now();
            let mut previous = Some(10u64);
            for offset in 11..=1_000_010u64 {
                let advance = active_window_advance(previous, offset);
                tracker.apply_advance(black_box(advance));
                previous = Some(offset);
            }
            black_box(tracker.coverage_ms((10, 1)));
            started.elapsed()
        }

        let disabled = run(0, false);
        let thirty_two_closed = run(0, true);
        let four_active = run(4, true);
        eprintln!(
            "coverage_hit_path disabled={disabled:?} closed32={thirty_two_closed:?} active4={four_active:?}"
        );
    }
}
