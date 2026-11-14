import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import type { LinkRecord } from "@redirect/shared";

const mockNavigate = vi.fn();
vi.mock("wouter", () => ({
  Link: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
  useLocation: () => ["/", mockNavigate],
}));

// Mock sonner toast
vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

import { LinkRow } from "../src/components/LinkRow";

describe("LinkRow Component", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const dummyLink: LinkRecord = {
    id: "rec_12345",
    slug: "my-custom-slug",
    targetUrl: "https://example.com/very/long/destination/url",
    title: "Example Title",
    statusCode: 307,
    isActive: true,
    forwardQuery: true,
    clickCount: 42,
    createdAt: new Date(1700000000000).toISOString(),
    updatedAt: new Date(1700000000000).toISOString(),
    lastClickedAt: null,
    expiresAt: null,
    tags: ["tech", "blog"],
  };

  it("renders slug, target url, and badges with standard sizing", () => {
    render(
      <LinkRow
        link={dummyLink}
        onUpdate={vi.fn()}
        onDelete={vi.fn()}
        onOpenEdit={vi.fn()}
        onOpenQr={vi.fn()}
      />
    );

    expect(screen.getByText("/my-custom-slug")).toBeInTheDocument();
    expect(screen.getByText("Example Title •")).toBeInTheDocument();
    expect(screen.getByText("https://example.com/very/long/destination/url")).toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(screen.getByText("+query")).toBeInTheDocument();
    expect(screen.getByText("#tech")).toBeInTheDocument();
    expect(screen.getByText("#blog")).toBeInTheDocument();
    expect(screen.getByText("42 clicks")).toBeInTheDocument();
  });

  it("navigates to link stats when clicking on the row card", () => {
    const { container } = render(
      <LinkRow
        link={dummyLink}
        onUpdate={vi.fn()}
        onDelete={vi.fn()}
        onOpenEdit={vi.fn()}
        onOpenQr={vi.fn()}
      />
    );

    const card = container.querySelector(".cursor-pointer");
    expect(card).not.toBeNull();
    fireEvent.click(card!);

    expect(mockNavigate).toHaveBeenCalledWith("/links/rec_12345");
  });

  it("does not navigate when clicking copy button or switch", async () => {
    // Mock navigator.clipboard
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    });

    render(
      <LinkRow
        link={dummyLink}
        onUpdate={vi.fn()}
        onDelete={vi.fn()}
        onOpenEdit={vi.fn()}
        onOpenQr={vi.fn()}
      />
    );

    const copyBtn = screen.getByRole("button", { name: /copy short link/i });
    await act(async () => {
      fireEvent.click(copyBtn);
    });

    expect(mockNavigate).not.toHaveBeenCalled();

    const switchBtn = screen.getByRole("switch");
    await act(async () => {
      fireEvent.click(switchBtn);
    });

    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("disables the active toggle switch when the link is expired (H3.2/B29)", () => {
    const expiredLink: LinkRecord = {
      ...dummyLink,
      expiresAt: "2020-01-01T00:00:00.000Z",
    };

    render(
      <LinkRow
        link={expiredLink}
        onUpdate={vi.fn()}
        onDelete={vi.fn()}
        onOpenEdit={vi.fn()}
        onOpenQr={vi.fn()}
      />
    );

    const switchBtn = screen.getByRole("switch");
    expect(switchBtn).toBeDisabled();
    expect(screen.getByText("Expired")).toBeInTheDocument();
  });

  it("groups the active switch and clicks button on the left separately from the actions menu on mobile", () => {
    render(
      <LinkRow
        link={dummyLink}
        onUpdate={vi.fn()}
        onDelete={vi.fn()}
        onOpenEdit={vi.fn()}
        onOpenQr={vi.fn()}
      />
    );

    const switchBtn = screen.getByRole("switch");
    const clicksBtn = screen.getByRole("button", { name: /42 clicks/i });
    const actionsBtn = screen.getByRole("button", { name: /actions/i });

    const leftGroup = switchBtn.closest("div.flex.items-center.gap-3")!;
    expect(leftGroup).not.toBeNull();
    expect(leftGroup).toContainElement(switchBtn);
    expect(leftGroup).toContainElement(clicksBtn);
    expect(leftGroup).not.toContainElement(actionsBtn);

    const controlsRow = leftGroup.parentElement!;
    expect(controlsRow.className).toContain("justify-between");
    expect(controlsRow.className).toContain("sm:justify-end");
    expect(controlsRow).toContainElement(actionsBtn);
  });
});
