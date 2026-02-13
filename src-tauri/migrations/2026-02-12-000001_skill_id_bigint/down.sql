PRAGMA foreign_keys = OFF;

CREATE TABLE damage_skill_stats_old (
  encounter_id INTEGER NOT NULL,
  attacker_id INTEGER NOT NULL,
  defender_id INTEGER,
  skill_id INTEGER NOT NULL,
  hits INTEGER NOT NULL DEFAULT 0,
  total_value INTEGER NOT NULL DEFAULT 0,
  crit_hits INTEGER NOT NULL DEFAULT 0,
  lucky_hits INTEGER NOT NULL DEFAULT 0,
  crit_total INTEGER NOT NULL DEFAULT 0,
  lucky_total INTEGER NOT NULL DEFAULT 0,
  hp_loss_total INTEGER NOT NULL DEFAULT 0,
  shield_loss_total INTEGER NOT NULL DEFAULT 0,
  hit_details TEXT NOT NULL,
  monster_name TEXT,
  PRIMARY KEY (encounter_id, attacker_id, defender_id, skill_id),
  FOREIGN KEY(encounter_id) REFERENCES encounters(id) ON DELETE CASCADE
);

INSERT INTO damage_skill_stats_old (
  encounter_id, attacker_id, defender_id, skill_id, hits, total_value,
  crit_hits, lucky_hits, crit_total, lucky_total, hp_loss_total, shield_loss_total,
  hit_details, monster_name
)
SELECT
  encounter_id, attacker_id, defender_id, skill_id, hits, total_value,
  crit_hits, lucky_hits, crit_total, lucky_total, hp_loss_total, shield_loss_total,
  hit_details, monster_name
FROM damage_skill_stats;

DROP TABLE damage_skill_stats;
ALTER TABLE damage_skill_stats_old RENAME TO damage_skill_stats;

CREATE TABLE heal_skill_stats_old (
  encounter_id INTEGER NOT NULL,
  healer_id INTEGER NOT NULL,
  target_id INTEGER,
  skill_id INTEGER NOT NULL,
  hits INTEGER NOT NULL DEFAULT 0,
  total_value INTEGER NOT NULL DEFAULT 0,
  crit_hits INTEGER NOT NULL DEFAULT 0,
  lucky_hits INTEGER NOT NULL DEFAULT 0,
  crit_total INTEGER NOT NULL DEFAULT 0,
  lucky_total INTEGER NOT NULL DEFAULT 0,
  heal_details TEXT NOT NULL,
  monster_name TEXT,
  PRIMARY KEY (encounter_id, healer_id, target_id, skill_id),
  FOREIGN KEY(encounter_id) REFERENCES encounters(id) ON DELETE CASCADE
);

INSERT INTO heal_skill_stats_old (
  encounter_id, healer_id, target_id, skill_id, hits, total_value,
  crit_hits, lucky_hits, crit_total, lucky_total, heal_details, monster_name
)
SELECT
  encounter_id, healer_id, target_id, skill_id, hits, total_value,
  crit_hits, lucky_hits, crit_total, lucky_total, heal_details, monster_name
FROM heal_skill_stats;

DROP TABLE heal_skill_stats;
ALTER TABLE heal_skill_stats_old RENAME TO heal_skill_stats;

PRAGMA foreign_keys = ON;
