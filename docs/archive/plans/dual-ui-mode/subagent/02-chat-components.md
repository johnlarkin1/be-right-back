# Sub-Agent Task: Chat Components

## 🎯 Scope

Convert chat interface components to support dual UI modes:
- `ChatLayout.tsx`
- `ChatSidebar.tsx`
- `ChatInput.tsx`
- `MessageBubble.tsx`
- `InlineChatPanel.tsx`
- `ContactDetailPanel.tsx`

---

## 📁 Files to Modify

```
apps/desktop/src/components/chat/
├── ChatLayout.tsx
├── ChatSidebar.tsx
├── ChatInput.tsx
├── MessageBubble.tsx
├── InlineChatPanel.tsx
├── ContactDetailPanel.tsx
└── ConversationAnalysisModal.tsx
```

---

## 🔧 Task Breakdown

### 1. ChatLayout.tsx

**Changes:**
- Use semantic color tokens
- Remove hardcoded CRT colors
- Mode-aware empty state (ghost vs clean icon)

```tsx
// Empty state example
{isRetro ? (
  <Ghost emotion="thinking" size={64} />
) : (
  <div className="text-[var(--color-text-muted)]">
    <MessageSquare size={48} strokeWidth={1} />
    <p>No conversation selected</p>
  </div>
)}
```

---

### 2. ChatInput.tsx

**Current State:**
- Terminal prompt prefix `> `
- Blinking cursor animation
- Green glow on focus

**Changes Needed:**

```tsx
import { useUIMode } from "@/stores/themeStore";

function ChatInput({ onSend }) {
  const { isRetro } = useUIMode();
  
  return (
    <div className={`
      flex items-center gap-2 p-3
      border-t border-[var(--color-border)]
      bg-[var(--color-surface-elevated)]
    `}>
      {/* Terminal prompt - retro only */}
      {isRetro && (
        <span className="text-[var(--color-accent)] font-[var(--font-display)]">
          {">"}
        </span>
      )}
      
      <input
        type="text"
        placeholder={isRetro ? "Enter message..." : "Type a message..."}
        className={`
          flex-1 bg-transparent outline-none
          text-[var(--color-text-primary)]
          font-[var(--font-body)]
          placeholder:text-[var(--color-text-muted)]
          ${isRetro ? "cursor-blink" : ""}
        `}
      />
      
      {/* Send button */}
      <button className="...">
        {isRetro ? "[↵]" : <Send size={18} />}
      </button>
    </div>
  );
}
```

**Style Differences:**
| Element | Retro | Modern |
|---------|-------|--------|
| Prompt prefix | `> ` visible | Hidden |
| Cursor | Blinking block | Standard caret |
| Send button | `[↵]` text | Send icon |
| Focus state | Green glow | Subtle border |

---

### 3. MessageBubble.tsx

**Current State:**
- Terminal-style messages with `>` prefix
- Green/amber background tints
- Text glow effects

**Changes Needed:**

```tsx
import { useUIMode } from "@/stores/themeStore";

interface MessageBubbleProps {
  message: string;
  isUser: boolean;
  timestamp?: string;
}

function MessageBubble({ message, isUser, timestamp }: MessageBubbleProps) {
  const { isRetro } = useUIMode();
  
  return (
    <div className={`
      flex ${isUser ? "justify-end" : "justify-start"}
    `}>
      <div className={`
        max-w-[70%] px-4 py-2
        ${isUser
          ? "bg-[var(--message-user-bg)] border border-[var(--message-user-border)]"
          : "bg-[var(--message-persona-bg)] border border-[var(--message-persona-border)]"
        }
        ${isRetro
          ? "rounded-sm"
          : isUser
            ? "rounded-2xl rounded-br-sm"
            : "rounded-2xl rounded-bl-sm"
        }
      `}>
        {/* Retro prefix */}
        {isRetro && (
          <span className="text-[var(--color-accent-dim)] mr-1">
            {isUser ? ">" : "<"}
          </span>
        )}
        
        {/* Message content */}
        <span className={`
          text-[var(--color-text-primary)]
          ${isRetro ? "text-glow font-mono" : ""}
        `}>
          {message}
        </span>
        
        {/* Timestamp */}
        {timestamp && (
          <span className="ml-2 text-xs text-[var(--color-text-muted)]">
            {timestamp}
          </span>
        )}
      </div>
    </div>
  );
}
```

**Style Differences:**
| Element | Retro | Modern |
|---------|-------|--------|
| Shape | Sharp corners | Rounded bubbles |
| Prefix | `>` / `<` | None |
| Text effect | Glow | None |
| Font | Monospace | Sans-serif |
| Position | Full width | Aligned left/right |

---

### 4. ChatSidebar.tsx

**Changes:**
- Contact list styling
- Avatar treatment (ghost vs initials circle)
- Tab styling for Contacts/Personas

```tsx
// Contact avatar
{isRetro ? (
  <Ghost emotion="neutral" size={32} />
) : (
  <div className="w-8 h-8 rounded-full bg-[var(--color-accent-subtle)] 
                  flex items-center justify-center text-sm font-medium
                  text-[var(--color-accent)]">
    {contact.name.charAt(0)}
  </div>
)}
```

---

### 5. ContactDetailPanel.tsx

**Changes:**
- Stats cards styling
- Action buttons
- Header treatment

---

### 6. InlineChatPanel.tsx

**Changes:**
- Similar to ChatLayout inner content
- Empty states
- Loading indicators

---

## ✅ Acceptance Criteria

- [ ] Chat input prompt prefix toggles correctly
- [ ] Message bubbles have correct shape per mode
- [ ] No text glow in modern mode
- [ ] Avatars use initials circles in modern mode
- [ ] Send button uses correct icon/text
- [ ] All colors use CSS tokens
- [ ] Focus states are mode-appropriate
- [ ] Timestamp styling is consistent

---

## 🔖 Commit Message

```
feat(theme): convert chat components to dual-mode

- ChatInput: mode-aware prompt, cursor, send button
- MessageBubble: rounded vs sharp, prefix toggle
- ChatSidebar: avatar treatment per mode
- Remove hardcoded CRT values

Closes #XXX
```

---

## 🧪 Testing

1. Send messages in both modes - verify bubble styling
2. Check input focus states in both modes
3. Verify sidebar contact list appearance
4. Test empty states with ghost/icon
5. Confirm no visual artifacts during mode toggle
