A one-row summary of the ingested data, with a sync button.

Props: `messageCount`, `contactCount`, `chunkCount`, `lastSnapshot` (a display string or `null`), the optional `snapshotSize`, `embeddingsSize` and `totalSize`, `onRefresh`, `isRefreshing` and `className`.

- The component shortens counts: 184203 shows as 184.2K.
- You provide `lastSnapshot` and the sizes as formatted strings, for example "2h ago" and "1.2 GB".
- "Sync New Messages" opens a confirmation before it calls `onRefresh`.
- Each stat has a tooltip that explains the term.
- Give it the full content width. It wraps below about 1000px.

Live React component. Source: `apps/desktop/src/components/home/CompactStatsBar.tsx`.
