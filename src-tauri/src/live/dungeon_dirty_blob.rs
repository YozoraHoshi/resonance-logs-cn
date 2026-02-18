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
        _ => Ok(false),
    })?;

    Ok(out)
}
