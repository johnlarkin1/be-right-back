use common::{Result, get_stats_contact_dir};
use messages_db::{db, utils};
use tracing::info;

/// collects stats for a conversation
pub fn handle_stats(contact_id: &str, json: bool) -> Result<()> {
    info!(?contact_id, json, "Computing conversation statistics");

    // Get or create snapshot
    let snapshot_path = match db::get_latest_snapshot()? {
        Some(path) => {
            info!(?path, "Using existing snapshot");
            path
        }
        None => {
            info!("No snapshot found, creating new snapshot");
            db::create_snapshot()?
        }
    };

    let conn = db::open_chat_snapshot(&snapshot_path)?;
    let conversation = db::queries::get_conversation(&snapshot_path, contact_id)?;
    let message_rows = db::queries::get_message_rows_for_contact(&conn, contact_id)?;
    let (total_reactions, reactions_from_me, reactions_from_them) =
        db::queries::get_reactions_count(&conn, contact_id)?;
    let stats = calculate_stats(
        &conversation,
        &message_rows,
        total_reactions,
        reactions_from_me,
        reactions_from_them,
    )?;
    if json {
        let json_output = serde_json::to_string_pretty(&stats)?;
        println!("{}", json_output);
    } else {
        println!("{}", stats);
    }

    Ok(())
}

fn calculate_stats(
    conversation: &common::Conversation,
    message_rows: &[messages_db::db::schema::MessageRow],
    total_reactions: usize,
    reactions_from_me: usize,
    reactions_from_them: usize,
) -> Result<common::ConversationStats> {
    use std::collections::HashSet;

    let total_messages = conversation.messages.len();
    let messages_from_me = conversation.messages.iter().filter(|m| m.is_from_me).count();
    let messages_from_them = total_messages - messages_from_me;

    let total_days = (conversation.end_date.date_naive() - conversation.start_date.date_naive()).num_days();

    let mut unique_days: HashSet<chrono::NaiveDate> = HashSet::new();
    for msg in &conversation.messages {
        unique_days.insert(msg.timestamp.date_naive());
    }
    let days_messaged = unique_days.len();
    let days_missed = (total_days as usize).saturating_sub(days_messaged);

    // Days with no reply (days where only one person sent messages)
    let mut days_with_no_reply = 0;
    let mut days_by_sender: std::collections::HashMap<chrono::NaiveDate, (bool, bool)> =
        std::collections::HashMap::new();

    for msg in &conversation.messages {
        let date = msg.timestamp.date_naive();
        let entry = days_by_sender.entry(date).or_insert((false, false));
        if msg.is_from_me {
            entry.0 = true;
        } else {
            entry.1 = true;
        }
    }

    for (_date, (from_me, from_them)) in days_by_sender {
        if from_me ^ from_them {
            // XOR: exactly one is true
            days_with_no_reply += 1;
        }
    }

    // Average gap between consecutive messages
    let avg_gap_between_messages_secs = if conversation.messages.len() > 1 {
        let mut total_gap_secs = 0.0;
        for i in 1..conversation.messages.len() {
            let gap =
                (conversation.messages[i].timestamp - conversation.messages[i - 1].timestamp).num_seconds() as f64;
            total_gap_secs += gap;
        }
        Some(total_gap_secs / (conversation.messages.len() - 1) as f64)
    } else {
        None
    };

    // Message length statistics
    let mut lengths: Vec<usize> = Vec::new();
    let mut total_length_from_me = 0;
    let mut count_from_me = 0;
    let mut total_length_from_them = 0;
    let mut count_from_them = 0;

    for row in message_rows {
        // Calculate actual text length from either text or attributedBody
        let length = if let Some(ref text) = row.text {
            text.len()
        } else if let Some(ref attributed_body) = row.attributed_body {
            if let Some(decoded) = utils::decode_attributed_body(attributed_body) {
                decoded.len()
            } else {
                0
            }
        } else {
            0
        };

        if length > 0 {
            lengths.push(length);
            if row.is_from_me {
                total_length_from_me += length;
                count_from_me += 1;
            } else {
                total_length_from_them += length;
                count_from_them += 1;
            }
        }
    }

    lengths.sort_unstable();

    let avg_length_overall = if !lengths.is_empty() {
        lengths.iter().sum::<usize>() as f64 / lengths.len() as f64
    } else {
        0.0
    };
    let avg_length_from_me = if count_from_me > 0 {
        total_length_from_me as f64 / count_from_me as f64
    } else {
        0.0
    };
    let avg_length_from_them = if count_from_them > 0 {
        total_length_from_them as f64 / count_from_them as f64
    } else {
        0.0
    };

    let min_length = lengths.first().copied().unwrap_or(0);
    let max_length = lengths.last().copied().unwrap_or(0);
    let median_length = percentile(&lengths, 50);
    let percentile_25 = percentile(&lengths, 25);
    let percentile_75 = percentile(&lengths, 75);
    let percentile_90 = percentile(&lengths, 90);

    // Response time statistics
    let (avg_their_response_time_secs, avg_my_response_time_secs) = calculate_response_times(&conversation.messages);

    // Generate message length distributions (overall + per-sender)
    let mut lengths_from_me: Vec<usize> = Vec::new();
    let mut lengths_from_them: Vec<usize> = Vec::new();
    for (row, len) in message_rows.iter().zip(&lengths) {
        if row.is_from_me {
            lengths_from_me.push(*len);
        } else {
            lengths_from_them.push(*len);
        }
    }
    lengths_from_me.sort_unstable();
    lengths_from_them.sort_unstable();

    let distribution_overall = generate_distribution(&lengths);
    let distribution_from_me = generate_distribution(&lengths_from_me);
    let distribution_from_them = generate_distribution(&lengths_from_them);

    // Calculate daily message counts
    let daily_counts = calculate_daily_counts(&conversation.messages);

    // Save distribution to file
    let distribution_file = save_distribution(
        &conversation.contact.id,
        &conversation.contact.display_name,
        &distribution_overall,
        &distribution_from_me,
        &distribution_from_them,
        &daily_counts,
    )?;

    Ok(common::ConversationStats {
        contact_id: conversation.contact.id.clone(),
        contact_name: conversation.contact.display_name.clone(),
        message_counts: common::MessageCounts {
            total_messages,
            messages_from_me,
            messages_from_them,
            total_reactions,
            reactions_from_me,
            reactions_from_them,
        },
        temporal_stats: common::TemporalStats {
            days_messaged,
            days_missed,
            days_with_no_reply,
            total_days,
            avg_gap_between_messages_secs,
        },
        message_length_stats: common::MessageLengthStats {
            avg_length_overall,
            avg_length_from_me,
            avg_length_from_them,
            min_length,
            max_length,
            median_length,
            percentile_25,
            percentile_75,
            percentile_90,
        },
        response_time_stats: common::ResponseTimeStats {
            avg_their_response_time_secs,
            avg_my_response_time_secs,
        },
        distribution_file,
    })
}

/// Calculate percentile from sorted vector
fn percentile(sorted_values: &[usize], p: u8) -> usize {
    if sorted_values.is_empty() {
        return 0;
    }
    let index = (p as f64 / 100.0 * (sorted_values.len() - 1) as f64).round() as usize;
    sorted_values[index]
}

/// Calculate daily message counts for timeline visualization
fn calculate_daily_counts(messages: &[common::Message]) -> Vec<common::DailyMessageCount> {
    use std::collections::HashMap;

    let mut daily_map: HashMap<String, (usize, usize)> = HashMap::new();

    for msg in messages {
        let date = msg.timestamp.format("%Y-%m-%d").to_string();
        let entry = daily_map.entry(date).or_insert((0, 0));
        if msg.is_from_me {
            entry.0 += 1;
        } else {
            entry.1 += 1;
        }
    }

    let mut daily_counts: Vec<common::DailyMessageCount> = daily_map
        .into_iter()
        .map(|(date, (from_me, from_them))| common::DailyMessageCount {
            date,
            from_me,
            from_them,
            total: from_me + from_them,
        })
        .collect();

    // Sort by date
    daily_counts.sort_by(|a, b| a.date.cmp(&b.date));

    daily_counts
}

/// Calculate response times (bidirectional)
fn calculate_response_times(messages: &[common::Message]) -> (Option<f64>, Option<f64>) {
    let mut their_response_times: Vec<f64> = Vec::new();
    let mut my_response_times: Vec<f64> = Vec::new();

    for i in 1..messages.len() {
        let prev = &messages[i - 1];
        let curr = &messages[i];

        // If current message is from them and previous was from me
        if !curr.is_from_me && prev.is_from_me {
            let gap = (curr.timestamp - prev.timestamp).num_seconds() as f64;
            if gap > 0.0 {
                their_response_times.push(gap);
            }
        }

        // If current message is from me and previous was from them
        if curr.is_from_me && !prev.is_from_me {
            let gap = (curr.timestamp - prev.timestamp).num_seconds() as f64;
            if gap > 0.0 {
                my_response_times.push(gap);
            }
        }
    }

    let avg_their_response = if !their_response_times.is_empty() {
        Some(their_response_times.iter().sum::<f64>() / their_response_times.len() as f64)
    } else {
        None
    };

    let avg_my_response = if !my_response_times.is_empty() {
        Some(my_response_times.iter().sum::<f64>() / my_response_times.len() as f64)
    } else {
        None
    };

    (avg_their_response, avg_my_response)
}

/// Generate message length distribution with histogram and percentiles
fn generate_distribution(lengths: &[usize]) -> common::MessageLengthDistribution {
    // Histogram bins
    let bins = [
        (0, 10, "0-10"),
        (11, 25, "11-25"),
        (26, 50, "26-50"),
        (51, 100, "51-100"),
        (101, 200, "101-200"),
        (201, usize::MAX, "200+"),
    ];

    let total = lengths.len() as f64;
    let histogram = bins
        .iter()
        .map(|(min, max, range)| {
            let count = lengths.iter().filter(|&&len| len >= *min && len <= *max).count();
            let percentage = if total > 0.0 {
                (count as f64 / total) * 100.0
            } else {
                0.0
            };
            common::HistogramBin {
                range: range.to_string(),
                count,
                percentage,
            }
        })
        .collect();

    // Percentiles
    let percentile_values = [10, 25, 50, 75, 90, 95, 99];
    let percentiles = percentile_values
        .iter()
        .map(|&p| common::Percentile {
            percentile: p,
            value: percentile(lengths, p),
        })
        .collect();

    common::MessageLengthDistribution { histogram, percentiles }
}

/// Save distribution data to file with daily counts and per-sender distributions
fn save_distribution(
    contact_id: &str,
    contact_name: &Option<String>,
    distribution_overall: &common::MessageLengthDistribution,
    distribution_from_me: &common::MessageLengthDistribution,
    distribution_from_them: &common::MessageLengthDistribution,
    daily_counts: &[common::DailyMessageCount],
) -> Result<Option<String>> {
    let contact_stats_dir = get_stats_contact_dir(contact_id)?;
    let filepath = contact_stats_dir.join("distribution.json");

    let data = serde_json::json!({
        "contact_id": contact_id,
        "contact_name": contact_name,
        "daily_message_counts": daily_counts,
        "message_length_distribution": {
            "overall": distribution_overall,
            "from_me": distribution_from_me,
            "from_them": distribution_from_them,
        }
    });

    let json_str = serde_json::to_string_pretty(&data)?;
    std::fs::write(&filepath, json_str)?;

    Ok(Some(filepath.to_string_lossy().to_string()))
}
