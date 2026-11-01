import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";

const mockListLinks = vi.fn();
vi.mock("@/api/client", () => ({
  listLinks: (...args: any[]) => mockListLinks(...args),
  createLink: vi.fn(),
  updateLink: vi.fn(),
  deleteLink: vi.fn(),
}));

vi.mock("wouter", () => ({
  Link: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
  useLocation: () => ["/", vi.fn()],
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

import { DashboardPage } from "../src/pages/DashboardPage";

describe("DashboardPage Search Debounce", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockListLinks.mockResolvedValue({
      data: [],
      pagination: { total: 0, limit: 20, offset: 0, hasMore: false },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("debounces user search typing by 300ms before querying server", async () => {
    await act(async () => {
      render(<DashboardPage />);
    });

    // Initial mount calls listLinks once
    expect(mockListLinks).toHaveBeenCalledTimes(1);
    expect(mockListLinks).toHaveBeenLastCalledWith(
      expect.objectContaining({ search: undefined })
    );

    const searchInput = screen.getByPlaceholderText(/search by slug, url, title/i);

    // User types "hello" rapidly
    act(() => {
      fireEvent.change(searchInput, { target: { value: "h" } });
      fireEvent.change(searchInput, { target: { value: "he" } });
      fireEvent.change(searchInput, { target: { value: "hel" } });
      fireEvent.change(searchInput, { target: { value: "hell" } });
      fireEvent.change(searchInput, { target: { value: "hello" } });
    });

    // Immediately after typing, server should NOT have been queried for "hello" yet
    expect(mockListLinks).toHaveBeenCalledTimes(1);

    // Fast-forward 200ms (still within 300ms debounce window)
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(mockListLinks).toHaveBeenCalledTimes(1);

    // Fast-forward remaining 150ms (total > 300ms)
    await act(async () => {
      vi.advanceTimersByTime(150);
    });

    // Now listLinks should have been called with debounced search query
    expect(mockListLinks).toHaveBeenCalledTimes(2);
    expect(mockListLinks).toHaveBeenLastCalledWith(
      expect.objectContaining({ search: "hello" })
    );
  });

  it("immediately clears search when X button is clicked", async () => {
    await act(async () => {
      render(<DashboardPage />);
    });

    const searchInput = screen.getByPlaceholderText(/search by slug, url, title/i);
    act(() => {
      fireEvent.change(searchInput, { target: { value: "query" } });
    });

    // Advance 300ms so it resolves
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    expect(mockListLinks).toHaveBeenCalledTimes(2);

    // Click clear X button
    const clearBtn = screen.getByRole("button", { name: /clear search/i });
    await act(async () => {
      fireEvent.click(clearBtn);
    });

    // Input is cleared immediately
    expect((searchInput as HTMLInputElement).value).toBe("");
    // And listLinks was called immediately without search query
    expect(mockListLinks).toHaveBeenCalledTimes(3);
    expect(mockListLinks).toHaveBeenLastCalledWith(
      expect.objectContaining({ search: undefined })
    );
  });
});
