import { useEffect, useRef, useState } from "react";

import { AppShell } from "@/components/AppShell";
import { ThemeProvider } from "@/components/theme";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { HomeLayout } from "@/components/home/HomeLayout";
import { ChatLayout } from "@/components/chat/ChatLayout";
import { InsightsLayout } from "@/components/insights/InsightsLayout";
import { getInitializationStatus } from "@/services/tauri";
import type { TabId } from "@/types";

function App() {
  const [activeTab, setActiveTab] = useState<TabId>("insights");
  const userPickedTab = useRef(false);

  const changeTab = (tab: TabId) => {
    userPickedTab.current = true;
    setActiveTab(tab);
  };

  // The app opens on Insights. Before the first ingestion there is nothing to
  // show there, so open on Ask Casper, which hosts the setup flow.
  useEffect(() => {
    let cancelled = false;
    getInitializationStatus()
      .then((status) => {
        if (!cancelled && !userPickedTab.current && !status.has_vector_db) {
          setActiveTab("casper");
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <ThemeProvider>
      <AppShell
        activeTab={activeTab}
        onTabChange={changeTab}
        showWanderingGhost={false}
      >
        {/* Render all tabs but only display the active one.
            This keeps component state (Casper chat, insights data) alive
            across tab switches instead of unmounting and losing state. */}
        <div
          className={`flex-1 flex flex-col min-h-0 ${activeTab === "insights" ? "" : "hidden"}`}
        >
          <ErrorBoundary tabName="Insights">
            <InsightsLayout onNavigate={changeTab} />
          </ErrorBoundary>
        </div>
        <div
          className={`flex-1 flex flex-col min-h-0 ${activeTab === "casper" ? "" : "hidden"}`}
        >
          <ErrorBoundary tabName="Ask Casper">
            <HomeLayout onNavigate={changeTab} />
          </ErrorBoundary>
        </div>
        <div
          className={`flex-1 flex flex-col min-h-0 ${activeTab === "personas" ? "" : "hidden"}`}
        >
          <ErrorBoundary tabName="Personas">
            <ChatLayout onNavigate={changeTab} />
          </ErrorBoundary>
        </div>
      </AppShell>
    </ThemeProvider>
  );
}

export default App;
