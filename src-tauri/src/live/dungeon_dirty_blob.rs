#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DirtyDungeonTarget {
    pub target_id: i32,
    pub nums: i32,
    pub complete: i32,
}

#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct DirtyDungeonData {
    pub flow_state: Option<i32>,
    pub targets: Vec<DirtyDungeonTarget>,
    pub progress_state: Option<i32>,
}

const TAG_BEGIN: i32 = -2;
const TAG_END: i32 = -3;
const TAG_EMPTY: i32 = -4;
const PAD_BYTES: usize = 4;

struct BlobCursor<'a> {
    data: &'a [u8],
    offset: usize,
}

impl<'a> BlobCursor<'a> {
    fn new(data: &'a [u8]) -> Self {
        Self { data, offset: 0 }
    }

    fn set_offset(&mut self, offset: usize) {
        self.offset = offset.min(self.data.len());
    }

    fn read_i32_padded(&mut self) -> Result<i32, String> {
        if self.offset + 4 + PAD_BYTES > self.data.len() {
            return Err("unexpected eof while reading i32".to_string());
        }
        let v = i32::from_le_bytes([
            self.data[self.offset],
            self.data[self.offset + 1],
            self.data[self.offset + 2],
            self.data[self.offset + 3],
        ]);
        self.offset += 4 + PAD_BYTES;
        Ok(v)
    }

    fn read_string_padded(&mut self) -> Result<String, String> {
        let len = self.read_i32_padded()?;
        if len < 0 {
            return Err(format!("negative string length: {len}"));
        }
        let len = usize::try_from(len).map_err(|_| "string length overflow".to_string())?;
        let Some(end) = self.offset.checked_add(len) else {
            return Err("string length overflow".to_string());
        };
        if end + PAD_BYTES > self.data.len() {
            return Err("unexpected eof while reading string".to_string());
        }
        let text = std::str::from_utf8(&self.data[self.offset..end])
            .map_err(|error| format!("invalid utf8: {error}"))?
            .to_owned();
        self.offset = end + PAD_BYTES;
        Ok(text)
    }
}

fn parse_dungeon_target_data(cur: &mut BlobCursor<'_>) -> Result<DirtyDungeonTarget, String> {
    let mut out = DirtyDungeonTarget {
        target_id: 0,
        nums: 0,
        complete: 0,
    };

    parse_container(cur, |field, inner, _body_end| match field {
        1 => {
            out.target_id = inner.read_i32_padded()?;
            Ok(true)
        }
        2 => {
            out.nums = inner.read_i32_padded()?;
            Ok(true)
        }
        3 => {
            out.complete = inner.read_i32_padded()?;
            Ok(true)
        }
        _ => Ok(false),
    })?;

    Ok(out)
}

fn parse_target_map(cur: &mut BlobCursor<'_>) -> Result<Vec<DirtyDungeonTarget>, String> {
    let mut entries = Vec::new();

    let mut add = cur.read_i32_padded()?;
    let mut remove = 0;
    let mut update = 0;

    if add == TAG_EMPTY {
        return Ok(entries);
    }

    if add == -1 {
        add = cur.read_i32_padded()?;
    } else {
        remove = cur.read_i32_padded()?;
        update = cur.read_i32_padded()?;
    }

    if add < 0 || remove < 0 || update < 0 {
        return Err("negative map section size".to_string());
    }

    for _ in 0..add as usize {
        let _key = cur.read_i32_padded()?;
        let value = parse_dungeon_target_data(cur)?;
        entries.push(value);
    }

    for _ in 0..remove as usize {
        let _key = cur.read_i32_padded()?;
    }

    for _ in 0..update as usize {
        let _key = cur.read_i32_padded()?;
        let value = parse_dungeon_target_data(cur)?;
        entries.push(value);
    }

    Ok(entries)
}

const PROGRESS_STATE_NAME: &str = "ProgressState";

fn parse_dungeon_var_data(
    cur: &mut BlobCursor<'_>,
) -> Result<(Option<String>, Option<i32>), String> {
    let mut name = None;
    let mut value = None;
    parse_container(cur, |field, inner, _body_end| match field {
        1 => {
            name = Some(inner.read_string_padded()?);
            Ok(true)
        }
        2 => {
            value = Some(inner.read_i32_padded()?);
            Ok(true)
        }
        _ => Ok(false),
    })?;
    Ok((name, value))
}

fn parse_dungeon_var_list(cur: &mut BlobCursor<'_>) -> Result<Option<i32>, String> {
    let count = cur.read_i32_padded()?;
    if count == TAG_EMPTY {
        return Ok(None);
    }
    if count < 0 {
        return Err(format!("negative dungeon var list size: {count}"));
    }
    let mut progress_state = None;
    for _ in 0..count as usize {
        let (name, value) = parse_dungeon_var_data(cur)?;
        if name.as_deref() == Some(PROGRESS_STATE_NAME) {
            progress_state = value;
        }
    }
    Ok(progress_state)
}

fn parse_flow_info_state(cur: &mut BlobCursor<'_>) -> Result<Option<i32>, String> {
    let mut state = None;
    parse_container(cur, |field, inner, _body_end| match field {
        1 => {
            state = Some(inner.read_i32_padded()?);
            Ok(true)
        }
        _ => Ok(false),
    })?;
    Ok(state)
}

fn parse_container<F>(cur: &mut BlobCursor<'_>, mut handle_field: F) -> Result<(), String>
where
    F: FnMut(i32, &mut BlobCursor<'_>, usize) -> Result<bool, String>,
{
    let begin = cur.read_i32_padded()?;
    if begin != TAG_BEGIN {
        return Err(format!("invalid container begin tag: {begin}"));
    }

    let size = cur.read_i32_padded()?;
    if size == TAG_END {
        return Ok(());
    }
    if size < 0 {
        return Err(format!("invalid negative container size: {size}"));
    }

    let body_start = cur.offset;
    let body_end = body_start
        .checked_add(size as usize)
        .ok_or_else(|| "container size overflow".to_string())?;
    if body_end > cur.data.len() {
        return Err("container body exceeds buffer size".to_string());
    }

    let mut field = cur.read_i32_padded()?;
    while field > 0 {
        let handled = handle_field(field, cur, body_end)?;
        if !handled {
            cur.set_offset(body_end);
        }
        if cur.offset + 8 > cur.data.len() {
            break;
        }
        field = cur.read_i32_padded()?;
    }

    if field != TAG_END {
        cur.set_offset(body_end);
    }
    Ok(())
}

pub fn parse_dirty_dungeon_data(bytes: &[u8]) -> Result<DirtyDungeonData, String> {
    let mut cur = BlobCursor::new(bytes);
    let mut out = DirtyDungeonData::default();

    parse_container(&mut cur, |field, inner, _body_end| match field {
        // DungeonSyncData.flow_info
        2 => {
            out.flow_state = parse_flow_info_state(inner)?;
            Ok(true)
        }
        // DungeonSyncData.target
        4 => {
            parse_container(inner, |target_field, map_cur, _| match target_field {
                // DungeonTarget.target_data (map<int, DungeonTargetData>)
                1 => {
                    out.targets = parse_target_map(map_cur)?;
                    Ok(true)
                }
                _ => Ok(false),
            })?;
            Ok(true)
        }
        // DungeonSyncData.dungeon_var
        10 => {
            parse_container(inner, |var_field, list_cur, _| match var_field {
                1 => {
                    out.progress_state = parse_dungeon_var_list(list_cur)?;
                    Ok(true)
                }
                _ => Ok(false),
            })?;
            Ok(true)
        }
        _ => Ok(false),
    })?;

    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write_i32(out: &mut Vec<u8>, value: i32) {
        out.extend_from_slice(&value.to_le_bytes());
        out.extend_from_slice(&[0, 0, 0, 0]);
    }

    fn write_string(out: &mut Vec<u8>, value: &str) {
        let bytes = value.as_bytes();
        write_i32(out, i32::try_from(bytes.len()).expect("string fits i32"));
        out.extend_from_slice(bytes);
        out.extend_from_slice(&[0, 0, 0, 0]);
    }

    fn wrap_container(fields: &[u8]) -> Vec<u8> {
        let mut body = fields.to_vec();
        write_i32(&mut body, TAG_END);
        let mut out = Vec::new();
        write_i32(&mut out, TAG_BEGIN);
        write_i32(&mut out, i32::try_from(body.len()).expect("body fits i32"));
        out.extend(body);
        out
    }

    fn var_data(name: &str, value: i32) -> Vec<u8> {
        let mut fields = Vec::new();
        write_i32(&mut fields, 1);
        write_string(&mut fields, name);
        write_i32(&mut fields, 2);
        write_i32(&mut fields, value);
        wrap_container(&fields)
    }

    fn dungeon_var_field(vars: &[(&str, i32)]) -> Vec<u8> {
        let mut list = Vec::new();
        write_i32(
            &mut list,
            i32::try_from(vars.len()).expect("count fits i32"),
        );
        for (name, value) in vars {
            list.extend(var_data(name, *value));
        }
        let mut var_fields = Vec::new();
        write_i32(&mut var_fields, 1);
        var_fields.extend(list);
        let var_container = wrap_container(&var_fields);
        let mut root_fields = Vec::new();
        write_i32(&mut root_fields, 10);
        root_fields.extend(var_container);
        wrap_container(&root_fields)
    }

    #[test]
    fn field_10_extracts_progress_state() {
        let bytes = dungeon_var_field(&[("eatball", 22), ("ProgressState", 1)]);
        let decoded = parse_dirty_dungeon_data(&bytes).expect("valid blob");
        assert_eq!(decoded.progress_state, Some(1));
        assert!(decoded.targets.is_empty());
        assert_eq!(decoded.flow_state, None);
    }

    #[test]
    fn field_10_progress_state_zero() {
        let bytes = dungeon_var_field(&[("ProgressState", 0), ("affix_value", 369)]);
        let decoded = parse_dirty_dungeon_data(&bytes).expect("valid blob");
        assert_eq!(decoded.progress_state, Some(0));
    }

    #[test]
    fn field_10_without_progress_state_is_none() {
        let bytes = dungeon_var_field(&[("eatball", 22)]);
        let decoded = parse_dirty_dungeon_data(&bytes).expect("valid blob");
        assert_eq!(decoded.progress_state, None);
    }
}
