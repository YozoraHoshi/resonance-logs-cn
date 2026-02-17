use std::collections::BTreeMap;
use std::fmt;

#[derive(Copy, Clone, PartialEq, Eq)]
pub struct Server {
    src_addr: [u8; 4],
    src_port: u16,
    dst_addr: [u8; 4],
    dst_port: u16,
}

impl Server {
    pub fn new(src_addr: [u8; 4], src_port: u16, dst_addr: [u8; 4], dst_port: u16) -> Self {
        Self {
            src_addr,
            src_port,
            dst_addr,
            dst_port,
        }
    }
}

impl fmt::Display for Server {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "{}:{} -> {}:{}",
            ip_to_str(&self.src_addr),
            self.src_port,
            ip_to_str(&self.dst_addr),
            self.dst_port
        )
    }
}

fn ip_to_str(ip: &[u8; 4]) -> String {
    format!("{}.{}.{}.{}", ip[0], ip[1], ip[2], ip[3])
}

#[inline]
pub fn tcp_sequence_before(a: u32, b: u32) -> bool {
    (a.wrapping_sub(b) as i32) < 0
}

#[inline]
#[allow(dead_code)]
pub fn tcp_sequence_after(a: u32, b: u32) -> bool {
    (a.wrapping_sub(b) as i32) > 0
}

pub struct TCPReassembler {
    cache: BTreeMap<u32, Vec<u8>>, // sequence -> payload
    next_seq: Option<u32>,         // next expected sequence
    buffered_bytes: usize,         // Total bytes currently in the cache
}

const MAX_TCP_CACHE_SIZE: usize = 5 * 1024 * 1024; // 5MB limit

impl TCPReassembler {
    pub fn new() -> Self {
        Self {
            cache: BTreeMap::new(),
            next_seq: None,
            buffered_bytes: 0,
        }
    }

    /// Insert a TCP payload segment for the given sequence number.
    /// Returns Some(Vec<u8>) when new contiguous bytes starting at the
    /// expected sequence become available.
    pub fn insert_segment(&mut self, sequence_number: u32, payload: &[u8]) -> Option<Vec<u8>> {
        if payload.is_empty() {
            return None;
        }

        let expected = match self.next_seq {
            Some(seq) => seq,
            None => {
                self.next_seq = Some(sequence_number);
                sequence_number
            }
        };

        let mut start_seq = sequence_number;
        let mut data = payload;

        if tcp_sequence_before(start_seq, expected) {
            let overlap = expected.wrapping_sub(start_seq) as usize;
            if overlap >= data.len() {
                return None;
            }
            start_seq = expected;
            data = &data[overlap..];
        }

        // Avoid storing duplicates unless the new payload is longer.
        match self.cache.get_mut(&start_seq) {
            Some(existing) => {
                if data.len() > existing.len() {
                    self.buffered_bytes -= existing.len();
                    existing.clear();
                    existing.extend_from_slice(data);
                    self.buffered_bytes += existing.len();
                }
            }
            None => {
                self.cache.insert(start_seq, data.to_vec());
                self.buffered_bytes += data.len();
            }
        }

        // Gap Skipping / Buffer Limit Enforcement
        if self.buffered_bytes > MAX_TCP_CACHE_SIZE {
            // If the buffer is too full, it implies we have a large gap we are waiting for.
            // We should give up on the missing data and jump to the earliest available packet.
            if let Some((&first_cached_seq, _)) = self.cache.iter().next() {
                log::warn!(
                    "TCPReassembler buffer exceeded limit ({} bytes). Skipping gap from {:?} to {}",
                    self.buffered_bytes,
                    self.next_seq,
                    first_cached_seq
                );
                // Advance expectation to the first thing we actually have
                self.next_seq = Some(first_cached_seq);
            }
        }

        let mut cursor = self.next_seq.unwrap();
        let mut output: Vec<u8> = Vec::new();

        while let Some(mut segment) = self.cache.remove(&cursor) {
            self.buffered_bytes -= segment.len();
            cursor = cursor.wrapping_add(segment.len() as u32);
            if output.is_empty() {
                output = std::mem::take(&mut segment);
            } else {
                output.extend_from_slice(&segment);
            }
        }

        if output.is_empty() {
            None
        } else {
            self.next_seq = Some(cursor);
            Some(output)
        }
    }

    pub fn reset(&mut self, next_seq: Option<u32>) {
        self.cache.clear();
        self.buffered_bytes = 0;
        self.next_seq = next_seq;
    }

    pub fn next_sequence(&self) -> Option<u32> {
        self.next_seq
    }
}

#[cfg(test)]
mod tests {
    use super::TCPReassembler;

    #[test]
    fn reassembles_in_order() {
        let mut reassembler = TCPReassembler::new();
        assert_eq!(
            reassembler.insert_segment(10, b"abc"),
            Some(b"abc".to_vec())
        );
        assert_eq!(
            reassembler.insert_segment(13, b"def"),
            Some(b"def".to_vec())
        );
    }

    #[test]
    fn reassembles_out_of_order_once_gap_filled() {
        let mut reassembler = TCPReassembler::new();
        assert_eq!(
            reassembler.insert_segment(100, b"abc"),
            Some(b"abc".to_vec())
        );
        assert!(reassembler.insert_segment(106, b"ghi").is_none());
        assert_eq!(
            reassembler.insert_segment(103, b"def"),
            Some(b"defghi".to_vec())
        );
    }

    #[test]
    fn trims_overlapping_segments_and_ignores_duplicates() {
        let mut reassembler = TCPReassembler::new();
        assert!(reassembler.insert_segment(50, b"abc").is_some());
        // Duplicate shorter payload should be ignored
        assert!(reassembler.insert_segment(50, b"ab").is_none());
        // Overlapping payload should emit only unseen bytes
        assert_eq!(
            reassembler.insert_segment(51, b"bcdef"),
            Some(b"def".to_vec())
        );
    }

    #[test]
    fn reset_drops_state_and_reinitializes() {
        let mut reassembler = TCPReassembler::new();
        assert!(reassembler.insert_segment(500, b"abc").is_some());
        reassembler.reset(None);
        assert_eq!(reassembler.next_sequence(), None);
        assert_eq!(
            reassembler.insert_segment(42, b"xyz"),
            Some(b"xyz".to_vec())
        );
    }
}
