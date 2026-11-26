/// SQLite schema types for the iMessage database
///
/// The Messages database schema varies slightly across macOS versions,
/// but the core tables (message, handle, chat) remain consistent.
use common::{Result, ServiceType, cocoa_to_unix};
use rusqlite::Row;

/// Raw message row from the SQLite database
#[derive(Debug)]
pub struct MessageRow {
    pub rowid: i64,
    pub text: Option<String>,
    pub attributed_body: Option<Vec<u8>>,
    pub is_from_me: bool,
    pub date: i64, // Apple Cocoa timestamp (seconds since 2001-01-01)
    pub service: Option<String>,
}

impl MessageRow {
    pub fn from_row(row: &Row) -> Result<Self> {
        Ok(MessageRow {
            rowid: row.get(0)?,
            text: row.get(1)?,
            attributed_body: row.get(2)?,
            is_from_me: row.get(3)?,
            date: row.get(4)?,
            service: row.get(5)?,
        })
    }

    /// Convert Apple Cocoa timestamp to Unix timestamp in seconds.
    pub fn to_unix_timestamp(&self) -> i64 {
        cocoa_to_unix(self.date)
    }
    pub fn parse_service(&self) -> ServiceType {
        match self.service.as_deref() {
            Some("iMessage") => ServiceType::IMessage,
            Some("SMS") => ServiceType::SMS,
            _ => ServiceType::IMessage,
        }
    }
}
