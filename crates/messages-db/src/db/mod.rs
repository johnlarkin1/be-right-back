/// Database module for iMessage chat.db access
///
/// This module uses a snapshot-based approach for safety:
/// 1. Create a snapshot of the live Messages database
/// 2. Work with the snapshot for all queries
/// 3. Track timestamps for incremental updates
pub mod parser;
pub mod queries;
pub mod query_strs;
pub mod schema;
pub mod snapshot;
pub mod tapbacks;

pub use snapshot::{create_snapshot, get_latest_snapshot, open_addressbook_snapshot, open_chat_snapshot};
