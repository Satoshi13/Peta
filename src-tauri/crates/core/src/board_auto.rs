//! Auto decisions are pure: observed Wi-Fi stays in the caller's memory.
use crate::boards::{PutResult, Rule};
use crate::{Database, Result};
use chrono::{Datelike, NaiveDate, NaiveDateTime, Timelike};
use rusqlite::{params, OptionalExtension};
use std::collections::{BTreeMap, HashMap, HashSet};

#[derive(Clone, Copy, Debug)]
pub enum WifiObservation<'a> {
    Unavailable,
    Disconnected,
    Connected(&'a str),
}
#[derive(Debug)]
pub struct Decision {
    pub winner: String,
    pub time_dates: Vec<(String, NaiveDate)>,
}
#[derive(Debug)]
pub struct Evaluation {
    pub decisions: Vec<Decision>,
    pub place_latches: HashSet<String>,
}
fn window(rule: &Rule, now: NaiveDateTime) -> Option<NaiveDate> {
    let (start, end) = (rule.start_min?, rule.end_min?);
    let minute = (now.hour() * 60 + now.minute()) as u16;
    let anchor = if (start < end && minute >= start && minute < end) || (start > end && minute >= start) {
        now.date()
    } else if start > end && minute < end {
        now.date().pred_opt()?
    } else {
        return None;
    };
    (rule.days & (1 << anchor.weekday().num_days_from_monday()) != 0).then_some(anchor)
}
/// All eligible contenders are consumed together, so a losing rule cannot overwrite
/// the winner on the next tick. Disconnected screens do not consume their start.
pub fn evaluate(
    rules: &[Rule],
    board_ids: &HashSet<String>,
    connected: &[String],
    now: NaiveDateTime,
    dates: &HashMap<String, NaiveDate>,
    wifi: WifiObservation<'_>,
    latches: &HashSet<String>,
) -> Evaluation {
    let mut ordered = rules.iter().collect::<Vec<_>>();
    ordered.sort_by(|a, b| (a.sort, &a.id).cmp(&(b.sort, &b.id)));
    let mut groups: BTreeMap<String, Vec<(&Rule, Option<NaiveDate>)>> = BTreeMap::new();
    let mut next = HashSet::new();
    for rule in ordered {
        if !rule.enabled || !board_ids.contains(&rule.board_id) {
            continue;
        }
        let present = connected.contains(&rule.display_id);
        let eligible = if rule.kind == "time" {
            window(rule, now)
                .filter(|_| present)
                .filter(|date| dates.get(&rule.id) != Some(date))
                .map(Some)
        } else if rule.kind == "place" {
            let matched = match wifi {
                WifiObservation::Unavailable => latches.contains(&rule.id),
                WifiObservation::Disconnected => false,
                WifiObservation::Connected(ssid) => rule.wifi.as_deref() == Some(ssid),
            };
            // Keep a consumed Wi-Fi start across an unplug; a new start waits for reconnect.
            if matched && (present || latches.contains(&rule.id)) {
                next.insert(rule.id.clone());
            }
            (present
                && matched
                && !latches.contains(&rule.id)
                && !matches!(wifi, WifiObservation::Unavailable))
            .then_some(None)
        } else {
            None
        };
        if let Some(date) = eligible {
            groups
                .entry(rule.display_id.clone())
                .or_default()
                .push((rule, date));
        }
    }
    Evaluation {
        decisions: groups
            .into_values()
            .map(|contenders| Decision {
                winner: contenders[0].0.id.clone(),
                time_dates: contenders
                    .into_iter()
                    .filter_map(|(r, d)| d.map(|date| (r.id.clone(), date)))
                    .collect(),
            })
            .collect(),
        place_latches: next,
    }
}
pub struct AutoPut {
    pub rule: Rule,
    pub board_name: String,
    pub result: PutResult,
}
pub struct AutoResult {
    pub applied: Vec<AutoPut>,
    pub place_latches: HashSet<String>,
}
impl Database {
    pub fn board_location_prompted(&self) -> Result<bool> {
        Ok(self
            .conn
            .query_row(
                "SELECT value FROM meta WHERE key='boards.location_prompted'",
                [],
                |r| r.get::<_, String>(0),
            )
            .optional()?
            .as_deref()
            == Some("1"))
    }
    pub fn board_location_mark_prompted(&mut self) -> Result<bool> {
        Ok(self.conn.execute(
            "INSERT OR IGNORE INTO meta VALUES ('boards.location_prompted','1')",
            [],
        )? > 0)
    }

    /// Placements, Undo and execution dates commit together. A failed paste can retry.
    pub fn board_auto(
        &mut self,
        now: NaiveDateTime,
        wifi: WifiObservation<'_>,
        connected: &[String],
        latches: &HashSet<String>,
    ) -> Result<AutoResult> {
        let tx = self.conn.transaction()?;
        let rules = crate::boards::rules(&tx)?;
        let mut q = tx.prepare("SELECT id,name FROM boards")?;
        let boards = q
            .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?
            .collect::<rusqlite::Result<HashMap<_, _>>>()?;
        drop(q);
        let mut dates = HashMap::new();
        for rule in &rules {
            let value: Option<String> = tx
                .query_row(
                    "SELECT value FROM meta WHERE key=?1",
                    [format!("boards.auto.{}", rule.id)],
                    |r| r.get(0),
                )
                .optional()?;
            if let Some(value) = value {
                let date = NaiveDate::parse_from_str(&value, "%Y-%m-%d")
                    .map_err(|_| crate::Error::Invalid("invalid_auto_date".into()))?;
                dates.insert(rule.id.clone(), date);
            }
        }
        let evaluation = evaluate(
            &rules,
            &boards.keys().cloned().collect(),
            connected,
            now,
            &dates,
            wifi,
            latches,
        );
        let mut applied = Vec::new();
        for decision in evaluation.decisions {
            let rule = rules.iter().find(|r| r.id == decision.winner).unwrap();
            let result = crate::boards::put_in(&tx, &rule.board_id, &rule.display_id)?;
            for (id, date) in decision.time_dates {
                tx.execute("INSERT INTO meta VALUES (?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value",params![format!("boards.auto.{id}"),date.to_string()])?;
            }
            applied.push(AutoPut {
                rule: rule.clone(),
                board_name: boards[&rule.board_id].clone(),
                result,
            });
        }
        tx.commit()?;
        Ok(AutoResult {
            applied,
            place_latches: evaluation.place_latches,
        })
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    fn rule(id: &str, sort: i64, kind: &str) -> Rule {
        Rule {
            id: id.into(),
            sort,
            kind: kind.into(),
            days: 1,
            start_min: Some(540),
            end_min: Some(1080),
            wifi: Some("Home".into()),
            display_id: "screen".into(),
            board_id: "board".into(),
            enabled: true,
        }
    }
    fn now(s: &str) -> NaiveDateTime {
        NaiveDateTime::parse_from_str(s, "%Y-%m-%d %H:%M").unwrap()
    }
    fn eval(
        rules: &[Rule],
        date: &str,
        dates: &HashMap<String, NaiveDate>,
        wifi: WifiObservation<'_>,
        latches: &HashSet<String>,
    ) -> Evaluation {
        evaluate(
            rules,
            &["board".into()].into(),
            &["screen".into()],
            now(date),
            dates,
            wifi,
            latches,
        )
    }
    #[test]
    fn time_windows_wake_once_and_overnight_anchor() {
        let mut r = rule("a", 0, "time");
        let empty = HashMap::new();
        let l = HashSet::new();
        assert!(eval(
            &[r.clone()],
            "2026-10-12 08:59",
            &empty,
            WifiObservation::Unavailable,
            &l
        )
        .decisions
        .is_empty());
        let e = eval(
            &[r.clone()],
            "2026-10-12 09:30",
            &empty,
            WifiObservation::Unavailable,
            &l,
        );
        assert_eq!(e.decisions[0].time_dates[0].1.to_string(), "2026-10-12");
        let dates = e.decisions[0].time_dates.clone().into_iter().collect();
        assert!(eval(
            &[r.clone()],
            "2026-10-12 17:59",
            &dates,
            WifiObservation::Unavailable,
            &l
        )
        .decisions
        .is_empty());
        assert!(eval(
            &[r.clone()],
            "2026-10-12 18:00",
            &empty,
            WifiObservation::Unavailable,
            &l
        )
        .decisions
        .is_empty());
        assert_eq!(
            eval(
                &[r.clone()],
                "2026-10-19 09:00",
                &dates,
                WifiObservation::Unavailable,
                &l
            )
            .decisions
            .len(),
            1
        );
        r.start_min = Some(1380);
        r.end_min = Some(120);
        assert_eq!(
            eval(
                &[r.clone()],
                "2026-10-13 01:30",
                &empty,
                WifiObservation::Unavailable,
                &l
            )
            .decisions[0]
                .time_dates[0]
                .1
                .to_string(),
            "2026-10-12"
        );
        assert!(eval(
            &[r],
            "2026-10-13 02:00",
            &empty,
            WifiObservation::Unavailable,
            &l
        )
        .decisions
        .is_empty());
    }
    #[test]
    fn priority_consumes_losers_and_wifi_edges() {
        let rules = [
            rule("lower", 2, "time"),
            rule("first", 0, "place"),
            rule("second", 1, "time"),
        ];
        let e = eval(
            &rules,
            "2026-10-12 09:00",
            &HashMap::new(),
            WifiObservation::Connected("Home"),
            &HashSet::new(),
        );
        assert_eq!(e.decisions[0].winner, "first");
        assert_eq!(e.decisions[0].time_dates.len(), 2);
        let dates = e.decisions[0].time_dates.clone().into_iter().collect();
        assert!(eval(
            &rules,
            "2026-10-12 09:01",
            &dates,
            WifiObservation::Connected("Home"),
            &e.place_latches
        )
        .decisions
        .is_empty());
        let unavailable = eval(
            &rules,
            "2026-10-12 09:01",
            &dates,
            WifiObservation::Unavailable,
            &e.place_latches,
        );
        assert_eq!(unavailable.place_latches, e.place_latches);
        let disconnected = eval(
            &rules,
            "2026-10-12 09:02",
            &dates,
            WifiObservation::Disconnected,
            &e.place_latches,
        );
        assert!(disconnected.place_latches.is_empty());
        assert_eq!(
            eval(
                &rules,
                "2026-10-12 09:03",
                &dates,
                WifiObservation::Connected("Home"),
                &disconnected.place_latches
            )
            .decisions
            .len(),
            1
        );
        assert!(eval(
            &rules,
            "2026-10-12 09:03",
            &dates,
            WifiObservation::Connected("Other"),
            &e.place_latches
        )
        .place_latches
        .is_empty());
    }
    #[test]
    fn reconnect_does_not_repeat_a_consumed_wifi_start() {
        let r = rule("a", 0, "place");
        let ids = ["board".into()].into();
        let dates = HashMap::new();
        let now = now("2026-10-12 09:00");
        let fired = evaluate(
            &[r.clone()],
            &ids,
            &["screen".into()],
            now,
            &dates,
            WifiObservation::Connected("Home"),
            &HashSet::new(),
        );
        let offline = evaluate(
            &[r.clone()],
            &ids,
            &[],
            now,
            &dates,
            WifiObservation::Connected("Home"),
            &fired.place_latches,
        );
        assert_eq!(offline.place_latches, fired.place_latches);
        assert!(evaluate(
            &[r.clone()],
            &ids,
            &["screen".into()],
            now,
            &dates,
            WifiObservation::Connected("Home"),
            &offline.place_latches
        )
        .decisions
        .is_empty());
        assert_eq!(
            evaluate(
                &[r.clone()],
                &ids,
                &[],
                now,
                &dates,
                WifiObservation::Unavailable,
                &offline.place_latches
            )
            .place_latches,
            offline.place_latches
        );
        let other = evaluate(
            &[r.clone()],
            &ids,
            &[],
            now,
            &dates,
            WifiObservation::Connected("Other"),
            &offline.place_latches,
        );
        let home = evaluate(
            &[r.clone()],
            &ids,
            &[],
            now,
            &dates,
            WifiObservation::Connected("Home"),
            &other.place_latches,
        );
        assert!(home.place_latches.is_empty());
        assert_eq!(
            evaluate(
                &[r],
                &ids,
                &["screen".into()],
                now,
                &dates,
                WifiObservation::Connected("Home"),
                &home.place_latches
            )
            .decisions
            .len(),
            1
        );
    }
    #[test]
    fn absent_screen_board_and_disabled_do_not_consume() {
        let r = rule("a", 0, "place");
        let e = HashSet::new();
        let d = HashMap::new();
        assert!(evaluate(
            &[r.clone()],
            &["board".into()].into(),
            &[],
            now("2026-10-12 09:00"),
            &d,
            WifiObservation::Connected("Home"),
            &e
        )
        .place_latches
        .is_empty());
        assert!(evaluate(
            &[r.clone()],
            &e,
            &["screen".into()],
            now("2026-10-12 09:00"),
            &d,
            WifiObservation::Connected("Home"),
            &e
        )
        .decisions
        .is_empty());
        let mut off = r;
        off.enabled = false;
        assert!(eval(
            &[off],
            "2026-10-12 09:00",
            &d,
            WifiObservation::Connected("Home"),
            &e
        )
        .decisions
        .is_empty());
    }
}
