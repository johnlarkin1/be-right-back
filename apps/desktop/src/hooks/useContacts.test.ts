import { renderHook, waitFor } from "@testing-library/react";
import { configureInvoke } from "@/test/mocks/tauri";
import {
  createContact,
  createYouContact,
  createContactDetailStats,
} from "@/test/fixtures";

vi.mock("@tauri-apps/api/core", async () => ({
  invoke: (await import("@/test/mocks/tauri")).mockInvoke,
}));

import { useContacts, useContactDetail } from "./useContacts";

describe("useContacts", () => {
  it("loads contacts on mount", async () => {
    const contacts = [
      createContact(),
      createContact({ contact_id: "contact-2", display_name: "Bob" }),
    ];
    configureInvoke("get_all_contacts", contacts);

    const { result } = renderHook(() => useContacts());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    expect(result.current.contacts).toEqual(contacts);
  });

  it("separates youContact from otherContacts", async () => {
    const you = createYouContact();
    const alice = createContact({ contact_id: "c1", display_name: "Alice" });
    const bob = createContact({ contact_id: "c2", display_name: "Bob" });
    configureInvoke("get_all_contacts", [you, alice, bob]);

    const { result } = renderHook(() => useContacts());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    expect(result.current.youContact).toEqual(you);
    expect(result.current.otherContacts).toHaveLength(2);
    expect(result.current.otherContacts).toEqual([alice, bob]);
  });

  it("handles empty contact list", async () => {
    configureInvoke("get_all_contacts", []);

    const { result } = renderHook(() => useContacts());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    expect(result.current.contacts).toEqual([]);
    expect(result.current.youContact).toBeNull();
    expect(result.current.otherContacts).toEqual([]);
  });

  it("handles error from invoke", async () => {
    configureInvoke("get_all_contacts", () => {
      throw new Error("DB locked");
    });

    const { result } = renderHook(() => useContacts());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    expect(result.current.error).toBe("DB locked");
    expect(result.current.contacts).toEqual([]);
  });

  it("refresh() re-fetches contacts", async () => {
    const initial = [createContact()];
    configureInvoke("get_all_contacts", initial);

    const { result } = renderHook(() => useContacts());

    await waitFor(() => {
      expect(result.current.contacts).toEqual(initial);
    });

    const updated = [
      createContact(),
      createContact({ contact_id: "c2", display_name: "Bob" }),
    ];
    configureInvoke("get_all_contacts", updated);

    await result.current.refresh();

    await waitFor(() => {
      expect(result.current.contacts).toEqual(updated);
    });
  });
});

describe("useContactDetail", () => {
  it("fetches stats when contactId is provided", async () => {
    const stats = createContactDetailStats({ contact_id: "c1" });
    configureInvoke("get_contact_detail_stats", stats);

    const { result } = renderHook(() => useContactDetail("c1"));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    expect(result.current.stats).toEqual(stats);
    expect(result.current.error).toBeNull();
  });

  it("returns null stats when contactId is null", async () => {
    const { result } = renderHook(() => useContactDetail(null));

    // Should not be loading since contactId is null (isLoading starts false)
    expect(result.current.isLoading).toBe(false);
    expect(result.current.stats).toBeNull();
  });

  it("handles error from invoke", async () => {
    configureInvoke("get_contact_detail_stats", () => {
      throw new Error("Contact not found");
    });

    const { result } = renderHook(() => useContactDetail("bad-id"));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    expect(result.current.error).toBe("Contact not found");
    expect(result.current.stats).toBeNull();
  });
});
