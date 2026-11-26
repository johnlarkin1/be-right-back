"""LLM prompts for persona training and analytics."""


def _format_contact_metadata(metadata: dict | None, contact_name: str) -> str:
    """Format contact relationship metadata into a prompt section."""
    if not metadata:
        return ""
    total = metadata.get("total_messages", "unknown")
    from_me = metadata.get("messages_from_me", "unknown")
    from_them = metadata.get("messages_from_them", "unknown")
    span = metadata.get("conversation_span_days", "unknown")
    avg_per_week = metadata.get("avg_messages_per_week")
    first_date = metadata.get("first_message_date", "unknown")
    last_date = metadata.get("last_message_date", "unknown")
    avg_str = f"{avg_per_week:.1f}" if avg_per_week is not None else "unknown"

    return f"""
## Relationship Statistics
- Total messages exchanged: {total} ({from_me} from user, {from_them} from {contact_name})
- Conversation history: {span} days ({first_date} to {last_date})
- Average messages per week: {avg_str}
"""


def _format_self_metadata(metadata: dict | None, header: str = "Metadata") -> str:
    """Format self-analysis metadata into a prompt section."""
    if not metadata:
        return ""
    total = metadata.get("total_messages", "unknown")
    contacts_count = metadata.get("contacts_included") or metadata.get(
        "contacts_sampled", "unknown"
    )
    first_date = metadata.get("first_message_date", "unknown")
    last_date = metadata.get("last_message_date", "unknown")

    return f"""
## {header}
- Total messages from you: {total}
- Across {contacts_count} top contacts
- Conversation history: {first_date} to {last_date}
"""


def _format_topics(curated_data: dict) -> str:
    """Format topics from Phase 1 extraction into a prompt section."""
    topics = curated_data.get("topics", [])
    if not topics:
        return "- No specific topics identified"
    topic_lines = []
    for topic in topics:
        name = topic.get("name", "Unknown")
        freq = topic.get("frequency", "unknown")
        topic_lines.append(f"- **{name}**: {freq}")
    return "\n".join(topic_lines)


CLUSTER_LABEL_SYSTEM_PROMPT = """\
You name the subject of a group of text-message conversations.
You get the group's keywords, most distinctive first, and excerpts that use them.
The keywords are the main signal. The excerpts are casual and noisy: use them to see what the keywords mean.
Reply with a topic label of 1 to 3 words in Title Case, such as:
Fantasy Football, Apartment Hunting, Wedding Planning, Job Search, Dinner Plans, Running, Stock Trading, Login Codes.
Rules:
- Name the subject plainly. Do not judge it or guess intent: no "Scam", "Spam" or "Drama".
- Some groups share a kind of message, not a subject: quick replies, check-ins, congratulations.
  Name that kind. Do not name a detail that only one excerpt mentions.
- Name what the conversations are about, not who is talking.
- Never use a person's name.
- Give a label that no other group has taken.
- No punctuation, no quotes, no explanation.
- Output the label only."""


def build_cluster_label_prompt(
    keywords: list[str],
    sample_messages: list[str],
    existing_labels: list[str] | None = None,
    rejected: list[tuple[str, str]] | None = None,
) -> str:
    """User turn for the cluster labeler. Pair it with CLUSTER_LABEL_SYSTEM_PROMPT.

    `rejected` holds (label, reason) pairs from earlier attempts for this group.
    """
    taken = [lbl for lbl in (existing_labels or []) if lbl != "Uncategorized"]
    taken_section = f"Labels already taken: {', '.join(taken[-30:])}\n\n" if taken else ""
    excerpts = "\n---\n".join(sample_messages)
    rejected_section = ""
    if rejected:
        lines = "\n".join(
            f'- "{label}": {_REJECT_REASONS.get(why, why)}' for label, why in rejected
        )
        rejected_section = f"\n\nThese answers were rejected. Give a different label.\n{lines}"

    return f"""{taken_section}Keywords: {", ".join(keywords)}

Excerpts:
{excerpts}{rejected_section}

Label:"""


_REJECT_REASONS = {
    "duplicate": "another group already has this label; name what sets this group apart",
    "too generic": "too vague; name the subject",
    "contains a contact name": "uses a person's name",
    "too long": "too long; use 1 to 3 words",
    "too many words": "too long; use 1 to 3 words",
}


# =============================================================================
# TWO-PHASE PERSONALITY ANALYSIS PROMPTS
# =============================================================================


def build_quote_extraction_system_prompt() -> str:
    """Build the system prompt for Phase 1: Quote extraction.

    This prompt instructs the LLM to extract notable quotes, identify topics,
    and generate high-level insights from conversation data.

    Optimized for speed: requests only 5 quotes with simplified structure.
    """
    return """\
You are a conversation analyst extracting distinctive quotes that reveal personality.

You will receive conversation data in XML format where:
- <message role="user"> contains messages FROM the user (the friend)
- <message role="contact"> contains messages FROM the contact being analyzed

CRITICAL RULES:
1. ONLY extract quotes from <message role="contact"> messages - NEVER from <message role="user">
2. Each quote must be at least 15 characters
3. AVOID generic responses: "ok", "haha", "yeah", "lol", "sure", "nice", "sounds good"
4. Include DIVERSE emotions - not just positive/funny
5. Provide BRIEF context (5-10 words max) for each quote

QUOTE CATEGORIES:
- humor: Jokes, wit, sarcasm
- emotional: Feelings, affection, vulnerability
- opinionated: Strong views, preferences
- supportive: Encouraging, helpful
- frustrated: Complaints, venting

INSIGHTS: Generate exactly 3 non-obvious behavioral observations. Use gender-neutral language (they/them).

OUTPUT: Valid JSON only. No markdown, no explanation."""


def build_quote_extraction_user_prompt(
    contact_name: str,
    conversations_xml: str,
    metadata: dict | None = None,
) -> str:
    """Build the user prompt for Phase 1: Quote extraction.

    Args:
        contact_name: Name of the contact to analyze
        conversations_xml: XML-formatted conversation blocks
        metadata: Optional relationship metadata

    Returns:
        User prompt string for quote extraction
    """
    metadata_section = ""
    if metadata:
        total = metadata.get("total_messages", "unknown")
        first_date = metadata.get("first_message_date", "unknown")
        last_date = metadata.get("last_message_date", "unknown")
        metadata_section = f"""
## Metadata
- Total messages in history: {total}
- Conversation span: {first_date} to {last_date}
"""

    return f"""\
# Task: Extract Notable Quotes from {contact_name}'s Messages
{metadata_section}
## Conversation Data

{conversations_xml}

## Extraction Instructions

Extract exactly 5 distinctive quotes that reveal {contact_name}'s personality.

REQUIREMENTS:
- Extract exactly 5 quotes (one per category if applicable)
- Include at least 1 negative emotional moment (frustration, venting)
- NO DUPLICATE QUOTES

For each quote provide:
- text: The exact quote (verbatim, 15+ characters)
- category: One of: humor, emotional, opinionated, supportive, frustrated
- context: 5-10 word description of what prompted this

For topics, identify 3-5 frequent discussion areas:
- name: Topic name (e.g., "Fantasy Football", "Work")
- frequency: occasional | frequent | very_frequent

Output JSON:
{{
  "quotes": [{{"text": "...", "category": "...", "context": "..."}}],
  "topics": [{{"name": "...", "frequency": "..."}}],
  "insights": ["insight 1", "insight 2", "insight 3"]
}}"""


def build_personality_with_quotes_system_prompt() -> str:
    """Build the system prompt for Phase 2: Personality analysis with pre-curated quotes.

    This prompt instructs the LLM to synthesize a personality profile using
    quotes and insights that were extracted in Phase 1.
    """
    return """\
You are a personality analyst specializing in understanding communication patterns from text messages.

You will receive:
1. Pre-curated notable quotes (already selected for quality and distinctiveness)
2. Topic analysis with frequency and enthusiasm levels
3. High-level insights about communication patterns
4. Sample conversations for observing additional patterns

Your task is to synthesize these into a comprehensive personality profile.

CRITICAL OUTPUT FORMAT:
- Start your response DIRECTLY with the first section header: ### Insights
- Do NOT include any title, preamble, introduction, or summary before the first ### header
- Use exactly the ### headers specified in the instructions (no # or ## headers)
- Write 3-5 sentences per section analyzing patterns
- Do NOT search for new quotes - use ONLY the pre-curated quotes provided
- Do NOT repeat the same quote in multiple sections
- The "Notable Quotes Collection" section should organize the provided quotes thematically

CRITICAL: Use gender-neutral language (they/them/their) when referring to the contact. \
Never assume gender from names."""


def build_personality_with_quotes_user_prompt(
    contact_name: str,
    curated_data: dict,
    conversations_xml: str,
    metadata: dict | None = None,
) -> str:
    """Build the user prompt for Phase 2: Personality analysis with pre-curated quotes.

    Args:
        contact_name: Name of the contact to analyze
        curated_data: Dict from Phase 1 containing quotes, topics, insights
        conversations_xml: XML-formatted conversation blocks (smaller sample for context)
        metadata: Optional relationship metadata

    Returns:
        User prompt string for personality analysis
    """
    # Format insights from Phase 1
    insights_list = curated_data.get("insights", [])
    insights_section = (
        "\n".join(f"- {insight}" for insight in insights_list)
        if insights_list
        else "- No specific insights extracted"
    )

    topics_section = _format_topics(curated_data)

    # Format quotes by category
    quotes = curated_data.get("quotes", [])
    quotes_by_category: dict[str, list[dict]] = {}
    for quote in quotes:
        cat = quote.get("category", "casual_banter")
        if cat not in quotes_by_category:
            quotes_by_category[cat] = []
        quotes_by_category[cat].append(quote)

    category_labels = {
        "humor": "Humor & Wit",
        "emotional": "Emotional Moments",
        "opinionated": "Strong Opinions",
        "supportive": "Supportive & Caring",
        "frustrated": "Frustrated & Venting",
        "casual_banter": "Casual Banter & Stories",
    }

    quotes_section_parts = []
    for cat_key, cat_label in category_labels.items():
        cat_quotes = quotes_by_category.get(cat_key, [])
        if cat_quotes:
            quotes_section_parts.append(f"### {cat_label}")
            for q in cat_quotes[:5]:  # Limit to 5 per category
                text = q.get("text", "").replace("\n", " / ")
                context = q.get("context", "")
                quote_type = q.get("type", "single")
                type_indicator = " (multi-msg)" if quote_type == "multi" else ""
                quotes_section_parts.append(f'- "{text}"{type_indicator} — {context}')
            quotes_section_parts.append("")

    quotes_formatted = (
        "\n".join(quotes_section_parts) if quotes_section_parts else "No quotes extracted."
    )

    metadata_section = _format_contact_metadata(metadata, contact_name)

    return f"""\
# Task: Analyze {contact_name}'s Texting Personality
{metadata_section}
## Pre-Extracted Insights
{insights_section}

## Identified Topics
{topics_section}

## Pre-Curated Notable Quotes

{quotes_formatted}

## Sample Conversations (for additional pattern observation)

{conversations_xml}

## Analysis Instructions

Using the pre-curated quotes, topics, and insights above, write a comprehensive personality analysis of {contact_name}.
Provide 3-5 sentences for each section. Be specific and reference the provided data.

### Insights
Expand on the pre-extracted insights above. Explain what these patterns reveal about {contact_name}'s personality and communication style. \
These should be non-obvious observations about behavioral tendencies, not surface-level descriptions.

### Communication & Emotional Style
Analyze their overall communication style and emotional expression in one unified section. Cover: \
tone (casual, formal, warm, sarcastic), emotional expression (how they show excitement, frustration, affection), \
and texting mechanics (message length, punctuation, emoji usage, distinctive vocabulary or catchphrases).

### Personality Traits
List 4-6 core traits with brief explanations. You may cite ONE quote per trait as an example.

### Common Topics and Interests
Based on the topic analysis above, describe what they talk about most and what energizes them. \
Include frequency and enthusiasm levels from the extracted data.

### Relationship Context
Based on conversation depth, comfort level, and communication patterns, describe the likely relationship dynamic.

### Notable Quotes
List the 5 best quotes that showcase {contact_name}'s personality. Make sure they're impactful and show character.Just the quotes, no analysis needed:
- "quote text here"
- "another quote"
(Format as simple bullet list of quotes only)"""


# =============================================================================
# SELF-ANALYSIS PROMPTS (for "You" persona)
# =============================================================================


def build_self_quote_extraction_system_prompt() -> str:
    """Build the system prompt for Phase 1: Self-quote extraction.

    This prompt instructs the LLM to extract notable quotes from the USER's own
    messages (role="user") to understand their personal communication style.
    """
    return """\
You are analyzing YOUR OWN text messages to understand your personal communication style.

You will receive conversation data in XML format where:
- <message role="user"> contains YOUR messages (the person being analyzed)
- <message role="contact"> contains messages from your contacts (provided for context)

CRITICAL RULES:
1. ONLY extract quotes from <message role="user"> messages (YOUR messages)
2. Each quote must be at least 15 characters
3. AVOID generic responses: "ok", "haha", "yeah", "lol", "sure", "nice", "sounds good"
4. Include DIVERSE emotions - not just positive/funny
5. Notice how your style VARIES across different contacts
6. The contact_name in each block indicates who you were talking to

QUOTE CATEGORIES:
- humor: Jokes, wit, sarcasm you used
- emotional: Your feelings, affection, vulnerability
- opinionated: Your strong views, preferences
- supportive: How you encourage, help others
- frustrated: Your complaints, venting

INSIGHTS: Generate exactly 3 non-obvious observations about YOUR communication patterns.
CRITICAL: Use second-person language in insights: "You tend to...", "Your style...", "You often..."
NEVER use third-person (they/them/their) in insights - this is self-reflection.

OUTPUT: Valid JSON only. No markdown, no explanation."""


def build_self_quote_extraction_user_prompt(
    conversations_xml: str,
    metadata: dict | None = None,
) -> str:
    """Build the user prompt for Phase 1: Self-quote extraction.

    Args:
        conversations_xml: XML-formatted conversation blocks (from multiple contacts)
        metadata: Optional aggregated metadata about user's messaging

    Returns:
        User prompt string for self-quote extraction
    """
    metadata_section = _format_self_metadata(metadata, header="Metadata")

    return f"""\
# Task: Extract Notable Quotes from Your Own Messages
{metadata_section}
## Conversation Data (from multiple contacts)

{conversations_xml}

## Extraction Instructions

Extract exactly 5-7 distinctive quotes that reveal YOUR personality and communication style.

REQUIREMENTS:
- Extract from YOUR messages (<message role="user">) ONLY
- Include quotes from DIFFERENT contacts to show variation
- Include at least 1 negative emotional moment (frustration, venting)
- NO DUPLICATE QUOTES

For each quote provide:
- text: The exact quote (verbatim, 15+ characters)
- category: One of: humor, emotional, opinionated, supportive, frustrated
- context: 5-10 word description of what prompted this
- contact_name: Who you were talking to (from the conversation block)

For topics, identify 3-5 things YOU frequently talk about:
- name: Topic name (e.g., "Work stress", "Weekend plans")
- frequency: occasional | frequent | very_frequent

Output JSON:
{{
  "quotes": [{{"text": "...", "category": "...", "context": "...", "contact_name": "..."}}],
  "topics": [{{"name": "...", "frequency": "..."}}],
  "insights": ["You tend to use humor when...", "Your style varies depending on...", "You often express..."]
}}"""


def build_self_personality_system_prompt() -> str:
    """Build the system prompt for Phase 2: Self-personality analysis.

    This prompt instructs the LLM to create an insightful self-portrait
    using second-person language ("you/your").
    """
    return """\
You are a personality analyst creating a self-portrait for someone based on their text messages.

Your task is to write an insightful analysis speaking DIRECTLY to the reader using "you" and "your".

CRITICAL OUTPUT FORMAT:
- Start your response DIRECTLY with the first section header: ### Your Insights
- Do NOT include any title, preamble, introduction, or summary before the first ### header
- Use exactly the ### headers specified in the instructions (no # or ## headers)
- Write 3-5 sentences per section analyzing patterns
- Highlight VARIATIONS in style across different relationships
- Do NOT repeat the same quote in multiple sections

CRITICAL LANGUAGE REQUIREMENT:
- Use ONLY second-person language throughout: "You tend to...", "Your style...", "You often..."
- NEVER use third-person pronouns (they/them/their) - this analysis is about the READER
- FORBIDDEN examples: "They often use humor", "Their style is casual", "They tend to..."
- REQUIRED examples: "You often use humor", "Your style is casual", "You tend to..."
- Every sentence should address the reader directly as "you\""""


def build_self_personality_user_prompt(
    curated_data: dict,
    conversations_xml: str,
    metadata: dict | None = None,
) -> str:
    """Build the user prompt for Phase 2: Self-personality analysis.

    Args:
        curated_data: Dict from Phase 1 containing quotes, topics, insights
        conversations_xml: XML-formatted conversation blocks (smaller sample)
        metadata: Optional aggregated metadata

    Returns:
        User prompt string for self-personality analysis
    """
    # Format insights from Phase 1
    insights_list = curated_data.get("insights", [])
    insights_section = (
        "\n".join(f"- {insight}" for insight in insights_list)
        if insights_list
        else "- No specific insights extracted"
    )

    topics_section = _format_topics(curated_data)

    # Format quotes grouped by contact (to show variation)
    quotes = curated_data.get("quotes", [])
    quotes_by_contact: dict[str, list[dict]] = {}
    for quote in quotes:
        contact = quote.get("contact_name", "Unknown")
        if contact not in quotes_by_contact:
            quotes_by_contact[contact] = []
        quotes_by_contact[contact].append(quote)

    quotes_section_parts = []
    for contact_name, contact_quotes in quotes_by_contact.items():
        quotes_section_parts.append(f"### When texting {contact_name}")
        for q in contact_quotes[:3]:  # Limit to 3 per contact
            text = q.get("text", "").replace("\n", " / ")
            context = q.get("context", "")
            category = q.get("category", "")
            quotes_section_parts.append(f'- "{text}" [{category}] — {context}')
        quotes_section_parts.append("")

    quotes_formatted = (
        "\n".join(quotes_section_parts) if quotes_section_parts else "No quotes extracted."
    )

    metadata_section = _format_self_metadata(metadata, header="Your Messaging Statistics")

    return f"""\
# Task: Analyze Your Texting Personality
{metadata_section}
## Pre-Extracted Insights About You
{insights_section}

## What You Talk About
{topics_section}

## Your Notable Quotes (by contact)

{quotes_formatted}

## Sample Conversations (for additional pattern observation)

{conversations_xml}

## Analysis Instructions

Using the pre-curated quotes, topics, and insights above, write a comprehensive self-analysis of your texting personality.
Provide 3-5 sentences for each section. Use second-person language ("you", "your").

### Your Insights
Expand on the pre-extracted insights above. What do these patterns reveal about your communication style? \
What consistent themes appear across different relationships?

### Your Communication Style
How do you communicate differently with different people? \
Analyze your overall tone, emotional expression, and texting mechanics (message length, punctuation, emoji usage).

### Your Personality Traits
List 4-6 core personality traits evident in your messages, with brief explanations.

### What You Talk About
Based on the topic analysis, what subjects energize you? What do you bring up most often?

### How You Show Up in Relationships
What role do you typically play in conversations? Are you the planner, the cheerleader, the advisor, the comedian? \
How do you support others and express affection?

### Your Notable Quotes
List the best quotes that showcase your personality. Just the quotes, no analysis needed:
- "quote text here"
- "another quote"
(Format as simple bullet list of quotes only)

REMINDER: Write as if speaking directly to the reader. Use "you/your" throughout.
NEVER write "they/them/their" - this is self-reflection, not third-party analysis."""
