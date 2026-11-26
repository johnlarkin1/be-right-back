/// Utilities for working with contact names.
///
/// These helpers are shared across ingestion workflows to keep name handling
/// consistent everywhere we build display labels.
/// Build a display name from name components.
///
/// Prefers: first + last, then nickname, then first only, then last only.
pub fn build_display_name(
    first_name: Option<String>,
    last_name: Option<String>,
    _middle_name: Option<String>,
    nickname: Option<String>,
) -> String {
    match (first_name, last_name, nickname) {
        (Some(first), Some(last), _) => format!("{} {}", first, last),
        (Some(first), None, _) => first,
        (None, Some(last), _) => last,
        (None, None, Some(nick)) => nick,
        (None, None, None) => "Unknown".to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::build_display_name;

    #[test]
    fn prefers_first_last() {
        let name = build_display_name(
            Some("Ada".into()),
            Some("Lovelace".into()),
            None,
            Some("Countess".into()),
        );
        assert_eq!(name, "Ada Lovelace");
    }

    #[test]
    fn falls_back_to_nickname() {
        let name = build_display_name(None, None, None, Some("Ace".into()));
        assert_eq!(name, "Ace");
    }

    #[test]
    fn returns_unknown_when_empty() {
        let name = build_display_name(None, None, None, None);
        assert_eq!(name, "Unknown");
    }
}
