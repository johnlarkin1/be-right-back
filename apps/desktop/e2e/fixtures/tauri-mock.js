/**
 * Tauri IPC mock for Playwright E2E tests.
 *
 * Injected via page.addInitScript({ path }) BEFORE the app loads.
 * Based on the pattern from @tauri-apps/api/mocks.js — sets up
 * window.__TAURI_INTERNALS__ and window.__TAURI_EVENT_PLUGIN_INTERNALS__
 * so that invoke() and listen() work without the Tauri runtime.
 */
(function () {
  // ── Default mock responses ──────────────────────────────────────
  window.__MOCK_RESPONSES = {
    get_initialization_status: {
      has_fda_permission: true,
      has_snapshot: true,
      snapshot_date: "2025-01-14T12:00:00Z",
      snapshot_message_count: 42500,
      snapshot_contact_count: 128,
      has_sqlite_db: true,
      has_vector_db: true,
      has_base_model: true,
      has_trained_persona: true,
      current_stage: "fully_initialized",
      is_fully_initialized: true,
      snapshot_size_bytes: 52428800,
      snapshot_size_display: "50.0 MB",
      embeddings_size_bytes: 104857600,
      embeddings_size_display: "100.0 MB",
      total_data_size_bytes: 157286400,
      total_data_size_display: "150.0 MB",
      last_ingestion_date: "2025-01-14T12:00:00Z",
      last_ingestion_duration_secs: 120,
      chunk_count: 8500,
    },
    get_all_contacts: [
      {
        contact_id: "you-id",
        display_name: "You",
        is_you: true,
        message_count: 20000,
        has_trained_persona: false,
      },
      {
        contact_id: "alice-id",
        display_name: "Alice Smith",
        is_you: false,
        message_count: 5000,
        has_trained_persona: true,
      },
      {
        contact_id: "bob-id",
        display_name: "Bob Jones",
        is_you: false,
        message_count: 3000,
        has_trained_persona: false,
      },
    ],
    list_personas: [
      {
        id: "persona-alice",
        contact_id: "alice-id",
        contact_name: "Alice Smith",
        display_name: "Alice Smith",
        base_model: "mlx-community/Qwen3.5-4B-4bit",
        adapter_size_bytes: 5242880,
        adapter_size_display: "5.0 MB",
        trained_at: "2025-01-10T10:00:00Z",
        message_count: 2500,
      },
    ],
    get_contact_detail_stats: {
      contact_id: "alice-id",
      display_name: "Alice Smith",
      total_messages: 5000,
      sent_messages: 2500,
      received_messages: 2500,
      first_message_date: "2020-01-15T08:30:00Z",
      last_message_date: "2025-01-14T22:15:00Z",
      avg_messages_per_day: 2.7,
      longest_streak_days: 45,
      total_words: 125000,
      avg_words_per_message: 25,
    },
    get_insights_stats: {
      totalMessages: 42500,
      totalContacts: 128,
      totalChunks: 8500,
      avgMessagesPerDay: 23.4,
      topContactName: "Alice Smith",
      topContactMessages: 5000,
    },
    get_insights_timeline: {
      timelineData: [],
      aggregationType: "weekly",
    },
    get_insights_heatmap: {
      heatmapData: [],
    },
    get_insights_calendar: {
      calendarData: [],
    },
    get_word_frequencies: [],
    get_embeddings_for_viz: {
      points: [],
      clusters: [],
      totalPoints: 0,
      sampled: false,
    },
    get_casper_model_info: {
      displayName: "Qwen3.5 4B",
      modelId: "mlx-community/Qwen3.5-4B-4bit",
      tierName: "4B",
      quantization: "4bit",
    },
    get_ingestion_settings: null,
    get_conversation_analysis: null,
    list_snapshots: [
      {
        id: "snapshot-1",
        created_at: "2025-01-14T12:00:00Z",
        message_count: 42500,
        contact_count: 128,
      },
    ],
    get_message_date_range: {
      earliestDate: "2023-01-01",
      latestDate: "2025-01-14",
    },
    casper_list_conversations: [],
    // Commands that return void/null (actions)
    train_persona: null,
    download_base_model: null,
    run_ingestion: { success: true, message_count: 42500 },
    cancel_ingestion: null,
    create_snapshot: { success: true, message_count: 42500 },
    save_ingestion_settings: null,
    chat_with_persona_streaming: null,
    ask_casper_streaming: null,
    open_fda_settings: null,
    get_recommended_base_model: "mlx-community/Qwen3.5-4B-4bit",
    run_analytics_only: null,
    analyze_conversation: null,
  };

  // ── Event system ────────────────────────────────────────────────
  var eventListeners = {};
  var nextListenerId = 1;

  // ── Callback system (mirrors @tauri-apps/api internals) ─────────
  var callbacks = new Map();

  function transformCallback(callback, once) {
    var identifier =
      window.crypto.getRandomValues(new Uint32Array(1))[0];
    callbacks.set(identifier, function (data) {
      if (once) {
        callbacks.delete(identifier);
      }
      return callback && callback(data);
    });
    return identifier;
  }

  function unregisterCallback(id) {
    callbacks.delete(id);
  }

  function runCallback(id, data) {
    var callback = callbacks.get(id);
    if (callback) {
      callback(data);
    }
  }

  // ── Event plugin handlers ───────────────────────────────────────
  function handleListen(args) {
    var event = args.event;
    var handler = args.handler;
    if (!eventListeners[event]) {
      eventListeners[event] = {};
    }
    var id = nextListenerId++;
    eventListeners[event][id] = handler;
    return id;
  }

  function handleEmit(args) {
    var event = args.event;
    var payload = args.payload;
    var listeners = eventListeners[event];
    if (listeners) {
      Object.keys(listeners).forEach(function (id) {
        var handlerId = listeners[id];
        runCallback(handlerId, { event: event, payload: payload });
      });
    }
    return null;
  }

  function handleUnlisten(args) {
    var event = args.event;
    var id = args.id;
    if (eventListeners[event]) {
      var handlerId = eventListeners[event][id];
      if (handlerId !== undefined) {
        unregisterCallback(handlerId);
        delete eventListeners[event][id];
      }
    }
  }

  // ── IPC invoke ──────────────────────────────────────────────────
  async function invoke(cmd, args, _options) {
    // Handle event plugin commands
    if (cmd === "plugin:event|listen") {
      return handleListen(args);
    }
    if (cmd === "plugin:event|emit") {
      return handleEmit(args);
    }
    if (cmd === "plugin:event|unlisten") {
      return handleUnlisten(args);
    }

    // Look up mock response
    if (window.__MOCK_RESPONSES && cmd in window.__MOCK_RESPONSES) {
      var response = window.__MOCK_RESPONSES[cmd];
      // Return a deep clone to prevent mutation across calls
      return typeof response === "object" && response !== null
        ? JSON.parse(JSON.stringify(response))
        : response;
    }

    // Default: return null for unknown commands
    console.warn("[tauri-mock] No mock for command:", cmd, args);
    return null;
  }

  // ── Set up __TAURI_INTERNALS__ ──────────────────────────────────
  window.__TAURI_INTERNALS__ = {
    invoke: invoke,
    transformCallback: transformCallback,
    unregisterCallback: unregisterCallback,
    runCallback: runCallback,
    callbacks: callbacks,
    metadata: {
      currentWindow: { label: "main" },
      currentWebview: { windowLabel: "main", label: "main" },
    },
    convertFileSrc: function (filePath, protocol) {
      protocol = protocol || "asset";
      var path = encodeURIComponent(filePath);
      return protocol + "://localhost/" + path;
    },
  };

  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = {
    unregisterListener: function (event, id) {
      unregisterCallback(id);
    },
  };

  // ── Test bridge: emit events from test code into the app ────────
  window.__E2E_EMIT_EVENT = function (eventName, payload) {
    var listeners = eventListeners[eventName];
    if (listeners) {
      Object.keys(listeners).forEach(function (id) {
        var handlerId = listeners[id];
        runCallback(handlerId, { event: eventName, payload: payload });
      });
    }
  };
})();
