/**
 * Hook for fetching contacts with their training/lock status
 */
import { useState, useEffect, useCallback } from "react";
import { getAllContacts, getContactDetailStats } from "@/services/tauri";
import type { ContactWithStatus, ContactDetailStats } from "@/types";

interface UseContactsReturn {
  contacts: ContactWithStatus[];
  youContact: ContactWithStatus | null;
  otherContacts: ContactWithStatus[];
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useContacts(): UseContactsReturn {
  const [contacts, setContacts] = useState<ContactWithStatus[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchContacts = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const result = await getAllContacts();
      setContacts(result);
    } catch (err) {
      console.error("Failed to fetch contacts:", err);
      setError(err instanceof Error ? err.message : String(err));
      setContacts([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchContacts();
  }, [fetchContacts]);

  // Separate "You" contact from others
  const youContact = contacts.find((c) => c.is_you) ?? null;
  const otherContacts = contacts.filter((c) => !c.is_you);

  return {
    contacts,
    youContact,
    otherContacts,
    isLoading,
    error,
    refresh: fetchContacts,
  };
}

interface UseContactDetailReturn {
  stats: ContactDetailStats | null;
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useContactDetail(
  contactId: string | null,
): UseContactDetailReturn {
  const [stats, setStats] = useState<ContactDetailStats | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchStats = useCallback(async () => {
    if (!contactId) {
      setStats(null);
      return;
    }

    try {
      setIsLoading(true);
      setError(null);
      const result = await getContactDetailStats(contactId);
      setStats(result);
    } catch (err) {
      console.error("Failed to fetch contact stats:", err);
      setError(err instanceof Error ? err.message : String(err));
      setStats(null);
    } finally {
      setIsLoading(false);
    }
  }, [contactId]);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  return {
    stats,
    isLoading,
    error,
    refresh: fetchStats,
  };
}

export default useContacts;
