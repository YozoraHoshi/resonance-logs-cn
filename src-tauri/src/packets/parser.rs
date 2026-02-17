use crate::packets;
use crate::packets::opcodes::Pkt;
use bytes::Bytes;
use log::debug;

/// Parse a single notify fragment from a frame slice and return opcode + payload.
pub fn parse_notify_fragment(
    frame: &Bytes,
    payload_start: usize,
    payload_end: usize,
    compressed: bool,
) -> Option<(packets::opcodes::Pkt, Bytes)> {
    let payload = frame.get(payload_start..payload_end)?;
    if payload.len() < 16 {
        debug!("Notify: payload too short: {}", payload.len());
        return None;
    }

    let service_uuid = u64::from_be_bytes(payload[0..8].try_into().ok()?);
    // read and ignore stub id (4 bytes)
    let _stub_id = u32::from_be_bytes(payload[8..12].try_into().ok()?);
    let method_id_raw = u32::from_be_bytes(payload[12..16].try_into().ok()?);

    if service_uuid != 0x0000000063335342 {
        debug!("Notify: service_uuid mismatch: {service_uuid:x}");
        return None;
    }

    if compressed {
        match zstd::decode_all(&payload[16..]) {
            Ok(decoded) => Some((Pkt::try_from(method_id_raw).ok()?, Bytes::from(decoded))),
            Err(e) => {
                debug!("Notify: zstd decompression failed: {e}");
                None
            }
        }
    } else {
        Some((
            Pkt::try_from(method_id_raw).ok()?,
            frame.slice(payload_start + 16..payload_end),
        ))
    }
}
