/**
 * ChatLayout - The Personas tab
 *
 * Three screens:
 * - grid: one card per trained persona
 * - detail: contact sidebar + stats, analysis and training for one contact
 * - chat: contact sidebar + inline chat with a trained persona
 * Dual UI mode support (retro/modern).
 */
import { useState, useEffect, useCallback } from "react";
import { Users } from "lucide-react";
import { listPersonas } from "@/services/tauri";
import { Ghost } from "@/components/Ghost";
import { ModeAwareMascot } from "@/components/ModeAwareMascot";
import { NeedsSetup } from "@/components/home/NeedsSetup";
import { ChatSidebar } from "@/components/chat/ChatSidebar";
import { ContactDetailPanel } from "@/components/chat/ContactDetailPanel";
import { InlineChatPanel } from "@/components/chat/InlineChatPanel";
import { PersonasGrid } from "@/components/chat/PersonasGrid";
import { TrainingModal } from "@/components/chat/TrainingModal";
import { useContacts, useContactDetail } from "@/hooks/useContacts";
import { useChatMessages } from "@/hooks/useChatMessages";
import { useInitStatus } from "@/hooks/useInitStatus";
import { useUIMode } from "@/stores/themeStore";
import type { TabId, PersonasView, TrainedPersona } from "@/types";

interface ChatLayoutProps {
  onNavigate?: (tab: TabId) => void;
}

export function ChatLayout({ onNavigate }: ChatLayoutProps) {
  // Initialization status
  const { status: initStatus, isLoading: checkingPrereqs } = useInitStatus();

  // Which screen of the tab is showing
  const [view, setView] = useState<PersonasView>("grid");
  const [selectedContactId, setSelectedContactId] = useState<string | null>(
    null,
  );
  const [selectedPersonaId, setSelectedPersonaId] = useState<string | null>(
    null,
  );

  // Data hooks
  const { contacts, isLoading: contactsLoading } = useContacts();
  const { stats: contactStats, isLoading: statsLoading } = useContactDetail(
    view === "detail" ? selectedContactId : null,
  );

  // Personas state
  const [personas, setPersonas] = useState<TrainedPersona[]>([]);
  const [personasLoading, setPersonasLoading] = useState(false);

  // Training modal state
  const [trainingModalOpen, setTrainingModalOpen] = useState(false);
  const [trainingIsRetrain, setTrainingIsRetrain] = useState(false);

  // Thinking mode toggle (persisted to localStorage, default OFF)
  const [thinkingEnabled, setThinkingEnabled] = useState(() => {
    try {
      return localStorage.getItem("brb-thinking-mode") === "true";
    } catch {
      return false;
    }
  });
  const handleToggleThinking = useCallback(() => {
    setThinkingEnabled((prev) => {
      const next = !prev;
      try {
        localStorage.setItem("brb-thinking-mode", String(next));
      } catch {}
      return next;
    });
  }, []);

  // Use the chat hook for actual messaging (pass selected persona ID)
  const {
    messages: chatMessages,
    isLoading: chatLoading,
    streamingMessage,
    ragCount,
    sendMessage,
    clearMessages,
  } = useChatMessages(selectedPersonaId, thinkingEnabled);

  // Fetch personas — extracted as callback so it can be called after training
  const fetchPersonas = useCallback(async () => {
    try {
      setPersonasLoading(true);
      const result = await listPersonas();
      // TODO(rust-backend): Once list_personas returns Vec<TrainedPersona>
      // with full metadata, remove the string[] fallback below.
      if (Array.isArray(result) && result.length > 0) {
        if (typeof result[0] === "string") {
          // Fallback: old backend still returns string[]
          const personaList: TrainedPersona[] = (
            result as unknown as string[]
          ).map((id) => ({
            id,
            contact_id: id,
            contact_name: id,
            display_name: id,
            base_model: "qwen3-4b",
            adapter_size_bytes: 0,
            adapter_size_display: "N/A",
            trained_at: new Date().toISOString(),
            message_count: 0,
          }));
          setPersonas(personaList);
        } else {
          // New backend returns TrainedPersona[] directly
          setPersonas(result);
        }
      } else {
        setPersonas(result ?? []);
      }
    } catch (err) {
      console.error("Failed to fetch personas:", err);
      setPersonas([]);
    } finally {
      setPersonasLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPersonas();
  }, [fetchPersonas]);

  // Get selected contact
  const selectedContact = contacts.find(
    (c) => c.contact_id === selectedContactId,
  );

  // Get persona for selected contact (if trained)
  const selectedContactPersona = personas.find(
    (p) => p.contact_id === selectedContactId,
  );

  // Get selected persona for chat
  const selectedPersona = personas.find((p) => p.id === selectedPersonaId);

  // "You" is the only persona the app trains, so training always uses it.
  const youContact = contacts.find((c) => c.is_you);

  // Handle contact selection: show its detail screen
  const handleContactSelect = useCallback((contactId: string) => {
    setSelectedContactId(contactId);
    setView("detail");
  }, []);

  // Open a chat with a trained persona
  const openChat = useCallback((persona: TrainedPersona) => {
    setSelectedContactId(persona.contact_id);
    setSelectedPersonaId(persona.id);
    setView("chat");
  }, []);

  // Open the detail screen for "You", or the first contact
  const openYouDetail = useCallback(() => {
    const target = youContact ?? contacts[0];
    if (target) handleContactSelect(target.contact_id);
  }, [youContact, contacts, handleContactSelect]);

  // Handle generate persona — opens training modal
  const handleGeneratePersona = useCallback(() => {
    setTrainingIsRetrain(false);
    setTrainingModalOpen(true);
  }, []);

  // Handle chat with persona from contact detail
  const handleChatFromContact = useCallback(() => {
    if (selectedContactPersona) openChat(selectedContactPersona);
  }, [selectedContactPersona, openChat]);

  // Handle retrain — opens training modal with retrain warning
  const handleRetrain = useCallback(() => {
    setTrainingIsRetrain(true);
    setTrainingModalOpen(true);
  }, []);

  // Handle training complete — refresh persona list
  const handleTrainingComplete = useCallback(() => {
    fetchPersonas();
  }, [fetchPersonas]);

  // Open a chat with the persona the training modal just finished. The
  // persona list may still be refreshing, so select it once it appears.
  const [pendingChatContactId, setPendingChatContactId] = useState<
    string | null
  >(null);
  const handleChatWithTrained = useCallback(() => {
    setPendingChatContactId(youContact?.contact_id ?? null);
  }, [youContact]);
  useEffect(() => {
    if (!pendingChatContactId) return;
    const persona = personas.find((p) => p.contact_id === pendingChatContactId);
    if (persona) {
      openChat(persona);
      setPendingChatContactId(null);
    }
  }, [pendingChatContactId, personas, openChat]);

  // Handle clear chat
  const handleClearChat = useCallback(() => {
    clearMessages();
  }, [clearMessages]);

  // Loading state
  if (checkingPrereqs) {
    return (
      <div className="flex-1 flex items-center justify-center bg-[var(--color-surface)]">
        <ModeAwareMascot
          size={48}
          variant="sleepy"
          modernVariant="sparkles"
          animate={true}
        />
      </div>
    );
  }

  // Check if snapshot exists
  if (initStatus && !initStatus.has_snapshot) {
    return (
      <NeedsSetup
        title="Snapshot Required"
        description="Create a snapshot of your iMessage data first. This safely copies your messages for processing while keeping everything local on your device."
        actionLabel="Go to Setup"
        onAction={() => onNavigate?.("casper")}
        variant="green"
        ghostVariant="sleepy"
      />
    );
  }

  const trainingModal = youContact && (
    <TrainingModal
      isOpen={trainingModalOpen}
      onClose={() => setTrainingModalOpen(false)}
      contact={youContact}
      stats={youContact.contact_id === selectedContactId ? contactStats : null}
      isRetrain={trainingIsRetrain}
      onTrainingComplete={handleTrainingComplete}
      onChatWithPersona={handleChatWithTrained}
    />
  );

  if (view === "grid") {
    return (
      <div className="flex-1 flex min-h-0">
        <PersonasGrid
          personas={personas}
          youContact={youContact}
          onChat={openChat}
          onDetails={(persona) => handleContactSelect(persona.contact_id)}
          onTrainYou={openYouDetail}
          onBrowseContacts={openYouDetail}
        />
        {trainingModal}
      </div>
    );
  }

  return (
    <div className="flex-1 flex min-h-0">
      <ChatSidebar
        contacts={contacts}
        selectedContactId={selectedContactId}
        onContactSelect={handleContactSelect}
        onBack={() => setView("grid")}
        isLoading={contactsLoading || personasLoading}
      />

      <div className="flex-1 flex flex-col min-h-0">
        {view === "chat" && selectedPersona ? (
          <InlineChatPanel
            persona={selectedPersona}
            messages={chatMessages}
            streamingMessage={streamingMessage}
            isLoading={chatLoading}
            ragCount={ragCount}
            onSendMessage={sendMessage}
            onClearChat={handleClearChat}
            thinkingEnabled={thinkingEnabled}
            onToggleThinking={handleToggleThinking}
          />
        ) : selectedContact ? (
          <ContactDetailPanel
            contact={selectedContact}
            stats={contactStats}
            persona={selectedContactPersona ?? null}
            isLoading={statsLoading}
            onGeneratePersona={handleGeneratePersona}
            onChat={handleChatFromContact}
            onRetrain={handleRetrain}
          />
        ) : (
          <EmptyContactState />
        )}
      </div>

      {trainingModal}
    </div>
  );
}

/** Empty state when no contact selected */
function EmptyContactState() {
  const { isRetro } = useUIMode();

  return (
    <div className="flex-1 flex flex-col items-center justify-center text-center px-8 bg-[var(--color-surface)]">
      {isRetro ? (
        <Ghost size={48} variant="standard" color="green" animate />
      ) : (
        <div className="w-16 h-16 rounded-2xl bg-[var(--color-accent-subtle)] flex items-center justify-center">
          <Users size={32} className="text-[var(--color-accent)]" />
        </div>
      )}
      <h3
        className={`mt-4 mb-2 text-[var(--color-text-primary)] ${isRetro ? "font-[var(--font-display)]" : "font-[var(--font-body)] font-medium"}`}
      >
        Select a Contact
      </h3>
      <p
        className={`text-sm text-[var(--color-text-muted)] max-w-sm ${isRetro ? "font-mono" : "font-[var(--font-body)]"}`}
      >
        Choose a contact from the sidebar to see message stats and a personality
        analysis.
      </p>
    </div>
  );
}

export default ChatLayout;
