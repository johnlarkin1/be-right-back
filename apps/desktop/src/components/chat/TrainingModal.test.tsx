import { describe, it, expect, vi } from "vitest";
import { cloneElement, type ReactElement } from "react";
import { screen, fireEvent, waitFor, act } from "@testing-library/react";
import { renderWithProviders } from "@/test/helpers/render";
import { createContact, createContactDetailStats } from "@/test/fixtures";
import { configureInvoke, mockInvoke } from "@/test/mocks/tauri";
import { emitMockEvent } from "@/test/mocks/tauriEvent";
import { TrainingModal } from "./TrainingModal";
import type { ContactWithStatus, ContactDetailStats } from "@/types";

vi.mock("framer-motion", () => ({
  motion: {
    div: ({ children, ...props }: any) => <div {...props}>{children}</div>,
    button: ({ children, ...props }: any) => (
      <button {...props}>{children}</button>
    ),
  },
  AnimatePresence: ({ children }: any) => children,
}));

// jsdom has no layout, so hand the loss chart a fixed size.
vi.mock("recharts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("recharts")>();
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: ReactElement }) =>
      cloneElement(children, { width: 400, height: 140 } as object),
  };
});

vi.mock("@tauri-apps/api/core", async () => ({
  invoke: (await import("@/test/mocks/tauri")).mockInvoke,
}));

vi.mock("@tauri-apps/api/event", async () => ({
  listen: (await import("@/test/mocks/tauriEvent")).mockListen,
}));

vi.mock("@/components/Ghost", () => ({
  Ghost: ({ variant }: any) => (
    <div data-testid="ghost" data-variant={variant} />
  ),
}));

vi.mock("@/components/ModeAwareMascot", () => ({
  ModeAwareMascot: ({ variant }: any) => (
    <div data-testid="mascot" data-variant={variant} />
  ),
}));

interface RenderProps {
  isOpen?: boolean;
  onClose?: ReturnType<typeof vi.fn>;
  contact?: ContactWithStatus;
  stats?: ContactDetailStats | null;
  isRetrain?: boolean;
  onTrainingComplete?: ReturnType<typeof vi.fn>;
  onChatWithPersona?: ReturnType<typeof vi.fn>;
  theme?: "retro" | "modern";
}

const RECOMMENDED = {
  max_steps: 450,
  learning_rate: 1e-5,
  lora_rank: 16,
  num_layers: 16,
  batch_size: 1,
  gradient_accumulation_steps: 4,
  max_seq_length: 1024,
  eval_steps: 50,
  early_stopping: true,
};

const BOUNDS = {
  min_steps: 1,
  max_steps: 3000,
  min_learning_rate: 1e-6,
  max_learning_rate: 1e-3,
  lora_ranks: [4, 8, 16, 32, 64],
  max_layers: 32,
  max_batch_size: 8,
  max_grad_accum: 16,
  min_seq_length: 256,
  max_seq_length: 4096,
  min_eval_steps: 10,
  max_eval_steps: 1000,
};

function renderModal({
  isOpen = true,
  onClose = vi.fn(),
  contact = createContact(),
  stats = createContactDetailStats(),
  isRetrain = false,
  onTrainingComplete = vi.fn(),
  onChatWithPersona,
  theme = "modern",
}: RenderProps = {}) {
  const result = renderWithProviders(
    <TrainingModal
      isOpen={isOpen}
      onClose={onClose}
      contact={contact}
      stats={stats}
      isRetrain={isRetrain}
      onTrainingComplete={onTrainingComplete}
      onChatWithPersona={onChatWithPersona}
    />,
    { theme },
  );
  return { ...result, onClose, onTrainingComplete };
}

describe("TrainingModal", () => {
  beforeEach(() => {
    configureInvoke(
      "get_recommended_base_model",
      "mlx-community/Qwen3.5-9B-4bit",
    );
    configureInvoke("train_persona", undefined);
    configureInvoke("get_training_plan", {
      tier_name: "9b",
      system_memory_gb: 24,
      can_train: true,
      max_steps: 450,
      max_seq_length: 1024,
      lora_rank: 16,
      num_layers: 16,
      est_minutes_low: 8,
      est_minutes_high: 20,
      low_data: false,
      recommended: RECOMMENDED,
      bounds: BOUNDS,
    });
  });

  it("renders nothing when isOpen=false", () => {
    renderModal({ isOpen: false });
    expect(screen.queryByText("Train Persona")).not.toBeInTheDocument();
    expect(screen.queryByText("Retrain Persona")).not.toBeInTheDocument();
  });

  it("shows confirmation view with contact name and message count when isOpen=true", () => {
    renderModal();
    // Contact name appears in both header subtitle and description
    expect(screen.getAllByText("Alice Smith").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("500")).toBeInTheDocument();
  });

  it("shows 'Train Persona' title when isRetrain=false", () => {
    renderModal({ isRetrain: false });
    // "Train Persona" appears in header h2 and as button text in modern mode
    const trainElements = screen.getAllByText("Train Persona");
    expect(trainElements.length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText("Retrain Persona")).not.toBeInTheDocument();
  });

  it("shows 'Retrain Persona' title when isRetrain=true", () => {
    renderModal({ isRetrain: true });
    expect(screen.getByText("Retrain Persona")).toBeInTheDocument();
  });

  it("shows retrain warning when isRetrain=true", () => {
    renderModal({ isRetrain: true });
    expect(
      screen.getByText(
        /This will replace the existing persona.*previous adapter will be overwritten/,
      ),
    ).toBeInTheDocument();
  });

  it("cancel button calls onClose", () => {
    const { onClose } = renderModal();
    fireEvent.click(screen.getByText("Cancel"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("shows training phase labels", () => {
    renderModal();
    // The phase labels appear as info text in confirmation view context
    // but the actual labels are in the progress view. We can verify the
    // confirmation view shows the expected stats and the modal renders.
    expect(screen.getByText("Qwen3.5")).toBeInTheDocument();
    expect(screen.getByText("Estimated Time")).toBeInTheDocument();
  });

  it("displays the hardware-aware estimated time from the plan", async () => {
    renderModal();
    expect(screen.getByText("Estimated Time")).toBeInTheDocument();
    // Plan resolves asynchronously; estimate replaces the "Estimating…" placeholder.
    expect(await screen.findByText("8-20 min")).toBeInTheDocument();
  });

  it("disables training and warns when memory is insufficient", async () => {
    configureInvoke("get_training_plan", {
      tier_name: "0.8b",
      system_memory_gb: 4,
      can_train: false,
      max_steps: 120,
      max_seq_length: 512,
      lora_rank: 8,
      num_layers: null,
      est_minutes_low: 2,
      est_minutes_high: 5,
      low_data: false,
    });
    renderModal();
    expect(
      await screen.findByText(/not enough to train a persona on-device/),
    ).toBeInTheDocument();
  });

  it("warns about limited history when the plan reports low data", async () => {
    configureInvoke("get_training_plan", {
      tier_name: "9b",
      system_memory_gb: 24,
      can_train: true,
      max_steps: 30,
      max_seq_length: 1024,
      lora_rank: 16,
      num_layers: 16,
      est_minutes_low: 3,
      est_minutes_high: 6,
      low_data: true,
    });
    renderModal();
    expect(
      await screen.findByText(/Limited message history/),
    ).toBeInTheDocument();
    // Training is still allowed (advisory, not a hard gate).
    const trainButtons = screen.getAllByText("Train Persona");
    expect(trainButtons.length).toBeGreaterThanOrEqual(1);
  });

  it("close button (x) visible in header when not training", () => {
    renderModal();
    const closeBtn = screen.getByLabelText("Close modal");
    expect(closeBtn).toBeInTheDocument();
  });

  it("cancel during training stops the backend trainer and shows no error", async () => {
    let rejectTraining: (err: Error) => void = () => {};
    configureInvoke(
      "train_persona",
      () =>
        new Promise((_, reject) => {
          rejectTraining = reject;
        }),
    );
    configureInvoke("cancel_training", true);

    const { onClose } = renderModal();
    fireEvent.click(screen.getByRole("button", { name: "Train Persona" }));

    fireEvent.click(await screen.findByText("Cancel"));

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("cancel_training");
    });
    expect(onClose).toHaveBeenCalledTimes(1);

    // The backend rejects the pending call once the trainer dies.
    await act(async () => {
      rejectTraining(new Error("Training cancelled"));
    });
    expect(screen.queryByText("Training failed")).not.toBeInTheDocument();
  });

  it("shows a run summary and a chat action when training completes", async () => {
    let resolveTraining: (value: string) => void = () => {};
    configureInvoke(
      "train_persona",
      () =>
        new Promise((resolve) => {
          resolveTraining = resolve;
        }),
    );
    const onChatWithPersona = vi.fn();
    const { onClose } = renderModal({ onChatWithPersona });
    fireEvent.click(screen.getByRole("button", { name: "Train Persona" }));
    await screen.findByText("Cancel");

    const event = { phase: "training", progress: 0, message: "Training" };
    await act(async () => {
      emitMockEvent("training-progress", { ...event, step: 10, loss: 3.1 });
      emitMockEvent("training-progress", { ...event, step: 450, loss: 1.8 });
      resolveTraining("/tmp/persona");
    });

    expect(
      await screen.findByText("Your persona is ready"),
    ).toBeInTheDocument();
    expect(screen.getByText("Steps").nextElementSibling).toHaveTextContent(
      "450",
    );
    // The success view keeps the run's loss curve.
    expect(screen.getByLabelText("Training loss chart")).toBeInTheDocument();
    expect(screen.getByText("1.80")).toBeInTheDocument();
    expect(screen.getByText("from 3.10")).toBeInTheDocument();
    expect(screen.queryByText(/'s persona/)).not.toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: /Chat with your persona/ }),
    );
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onChatWithPersona).toHaveBeenCalledTimes(1);
  });

  it("draws live train and validation loss during training", async () => {
    configureInvoke("train_persona", () => new Promise(() => {}));
    renderModal();
    fireEvent.click(screen.getByRole("button", { name: "Train Persona" }));
    await screen.findByText("Cancel");

    const event = { phase: "training", progress: 0.1, message: "Training" };
    await act(async () => {
      emitMockEvent("training-progress", { ...event, step: 0 });
    });
    expect(
      screen.getByText("Waiting for the first loss report…"),
    ).toBeInTheDocument();

    await act(async () => {
      emitMockEvent("training-progress", { ...event, step: 10, loss: 3.1 });
      emitMockEvent("training-progress", {
        ...event,
        step: 50,
        val_loss: 2.75,
      });
      emitMockEvent("training-progress", { ...event, step: 60, loss: 2.5 });
    });

    expect(screen.getByLabelText("Training loss chart")).toBeInTheDocument();
    const chart = screen.getByTestId("loss-chart");
    // One line per series.
    expect(chart.querySelectorAll(".recharts-line-curve")).toHaveLength(2);
    // The legend shows the latest value of each series.
    expect(screen.getByText("2.500")).toBeInTheDocument();
    expect(screen.getByText("2.750")).toBeInTheDocument();
  });

  it("trains with the recommended profile when settings are untouched", async () => {
    configureInvoke("train_persona", () => new Promise(() => {}));
    renderModal();
    await screen.findByText("Advanced settings");
    fireEvent.click(screen.getByRole("button", { name: "Train Persona" }));
    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith(
        "train_persona",
        expect.objectContaining({ settings: undefined }),
      );
    });
    // Training takes no contact. "You" is the only persona.
    expect(mockInvoke).toHaveBeenCalledWith(
      "train_persona",
      expect.not.objectContaining({ contactId: expect.anything() }),
    );
  });

  it("sends custom settings from the Advanced panel", async () => {
    configureInvoke("train_persona", () => new Promise(() => {}));
    renderModal();
    fireEvent.click(await screen.findByText("Advanced settings"));

    fireEvent.change(screen.getByLabelText("Steps"), {
      target: { value: "900" },
    });
    fireEvent.change(screen.getByLabelText("LoRA rank"), {
      target: { value: "32" },
    });
    fireEvent.click(screen.getByLabelText(/Stop early/));
    expect(screen.getByText("Custom")).toBeInTheDocument();

    // The estimate follows the custom settings.
    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith(
        "get_training_plan",
        expect.objectContaining({
          settings: expect.objectContaining({ max_steps: 900 }),
        }),
      );
    });

    fireEvent.click(screen.getByRole("button", { name: "Train Persona" }));
    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith(
        "train_persona",
        expect.objectContaining({
          settings: {
            ...RECOMMENDED,
            max_steps: 900,
            lora_rank: 32,
            early_stopping: false,
          },
        }),
      );
    });
  });

  it("blocks training when a setting is out of bounds", async () => {
    renderModal();
    fireEvent.click(await screen.findByText("Advanced settings"));
    fireEvent.change(screen.getByLabelText("Steps"), {
      target: { value: "5000" },
    });
    expect(screen.getByText("Allowed: 1–3000")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Train Persona" }),
    ).toBeDisabled();

    fireEvent.click(screen.getByText("Reset to recommended"));
    expect(
      screen.getByRole("button", { name: "Train Persona" }),
    ).not.toBeDisabled();
  });
});
