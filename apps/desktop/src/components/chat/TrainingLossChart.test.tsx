import { describe, it, expect, vi } from "vitest";
import { cloneElement, type ReactElement } from "react";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/helpers/render";
import { configureInvoke, mockInvoke } from "@/test/mocks/tauri";
import { TrainingLossChart } from "./TrainingLossChart";

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

// jsdom has no canvas, so stand in for the PNG renderer.
const renderLossChartPng = vi.fn();
vi.mock("./exportLossChart", () => ({
  renderLossChartPng: (...args: unknown[]) => renderLossChartPng(...args),
}));

const POINTS = [
  { step: 10, loss: 3.1 },
  { step: 50, loss: 2.4, valLoss: 2.7 },
];

describe("TrainingLossChart", () => {
  it("hides the save button until there is a loss to draw", () => {
    renderWithProviders(
      <TrainingLossChart points={[]} totalSteps={100} isRetro={false} />,
      { theme: "modern" },
    );
    expect(screen.queryByText("Save PNG")).not.toBeInTheDocument();
  });

  it("saves the chart as a PNG", async () => {
    renderLossChartPng.mockResolvedValue(new Uint8Array([137, 80, 78, 71]));
    configureInvoke("save_loss_chart", "/Users/me/Downloads/loss.png");
    renderWithProviders(
      <TrainingLossChart points={POINTS} totalSteps={100} isRetro={false} />,
      { theme: "modern" },
    );

    fireEvent.click(screen.getByText("Save PNG"));

    expect(await screen.findByText("Saved to Downloads")).toBeInTheDocument();
    expect(renderLossChartPng).toHaveBeenCalledWith(
      expect.any(HTMLElement),
      [
        expect.objectContaining({ label: "Train", value: "2.400" }),
        expect.objectContaining({ label: "Val", value: "2.700" }),
      ],
      "Training loss",
    );
    expect(mockInvoke).toHaveBeenCalledWith("save_loss_chart", {
      png: [137, 80, 78, 71],
    });
  });

  it("reports a failed save", async () => {
    renderLossChartPng.mockRejectedValue(new Error("no canvas"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    renderWithProviders(
      <TrainingLossChart points={POINTS} totalSteps={100} isRetro={false} />,
      { theme: "modern" },
    );
    fireEvent.click(screen.getByText("Save PNG"));
    await waitFor(() =>
      expect(screen.getByText("Save failed")).toBeInTheDocument(),
    );
  });
});
