// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ModelCompatPopover from "../ModelCompatPopover";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

let container: HTMLDivElement;
let root: Root;

async function openPopover() {
  const trigger = container.querySelector("button") as HTMLButtonElement;
  await act(async () => trigger.click());
  await act(async () => {
    await Promise.resolve();
  });
}

function videoSwitch(): HTMLButtonElement | null {
  return document.querySelector('button[role="switch"][title="preserveVideoUrlLabel"]');
}

function renderPopover(extra: Record<string, unknown>) {
  act(() => {
    root.render(
      <ModelCompatPopover
        t={(key) => key}
        providerId="openai-compatible-chat-demo"
        modelId="qwen-vl-test"
        effectiveModelNormalize={() => false}
        effectiveModelPreserveDeveloper={() => true}
        getUpstreamHeadersRecord={() => ({})}
        onCompatPatch={vi.fn()}
        {...extra}
      />
    );
  });
}

describe("ModelCompatPopover video_url toggle (#9248)", () => {
  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    document.body.innerHTML = "";
  });

  it("is hidden when the host does not wire the video_url props", async () => {
    renderPopover({});
    await openPopover();
    expect(videoSwitch()).toBeNull();
  });

  it("shows the current state and reports the new value on click", async () => {
    const onPreserveVideoUrlChange = vi.fn();
    renderPopover({ effectiveModelPreserveVideoUrl: () => false, onPreserveVideoUrlChange });
    await openPopover();

    const toggle = videoSwitch();
    expect(toggle).toBeTruthy();
    expect(toggle!.getAttribute("aria-checked")).toBe("false");

    await act(async () => toggle!.click());
    expect(onPreserveVideoUrlChange).toHaveBeenCalledWith(true);
  });

  it("turns the flag off when it is currently on", async () => {
    const onPreserveVideoUrlChange = vi.fn();
    renderPopover({ effectiveModelPreserveVideoUrl: () => true, onPreserveVideoUrlChange });
    await openPopover();

    const toggle = videoSwitch();
    expect(toggle!.getAttribute("aria-checked")).toBe("true");

    await act(async () => toggle!.click());
    expect(onPreserveVideoUrlChange).toHaveBeenCalledWith(false);
  });

  it("is not affected by the selected protocol (the flag is model-level)", async () => {
    const onCompatPatch = vi.fn();
    const onPreserveVideoUrlChange = vi.fn();
    renderPopover({
      onCompatPatch,
      effectiveModelPreserveVideoUrl: () => false,
      onPreserveVideoUrlChange,
    });
    await openPopover();

    await act(async () => videoSwitch()!.click());
    expect(onPreserveVideoUrlChange).toHaveBeenCalledTimes(1);
    expect(onCompatPatch).not.toHaveBeenCalled();
  });
});
