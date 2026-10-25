import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { Button } from "../src/components/ui/button";
import { Badge } from "../src/components/ui/badge";
import { Card, CardHeader, CardTitle, CardContent } from "../src/components/ui/card";
import { AuthProvider, useAuth } from "../src/context/AuthContext";
import { AuthGate } from "../src/components/AuthGate";
import { AccessExpiredBanner } from "../src/components/AccessExpiredBanner";

describe("UI Components", () => {
  it("renders Button with custom label and click handler", () => {
    const handleClick = vi.fn();
    render(<Button onClick={handleClick}>Click Me</Button>);

    const btn = screen.getByRole("button", { name: /click me/i });
    expect(btn).toBeInTheDocument();
    fireEvent.click(btn);
    expect(handleClick).toHaveBeenCalledTimes(1);
  });

  it("renders Badge variants correctly", () => {
    const { container } = render(
      <div>
        <Badge variant="default">Default</Badge>
        <Badge variant="success">Active</Badge>
        <Badge variant="destructive">Expired</Badge>
      </div>
    );
    expect(container.textContent).toContain("Default");
    expect(container.textContent).toContain("Active");
    expect(container.textContent).toContain("Expired");
  });

  it("renders Card with header and content", () => {
    render(
      <Card>
        <CardHeader>
          <CardTitle>My Card Title</CardTitle>
        </CardHeader>
        <CardContent>
          <p>Card body content</p>
        </CardContent>
      </Card>
    );

    expect(screen.getByText("My Card Title")).toBeInTheDocument();
    expect(screen.getByText("Card body content")).toBeInTheDocument();
  });
});

describe("AuthGate & AccessExpiredBanner", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("renders AuthGate with unlock form when unauthenticated", async () => {
    // Mock global fetch to return 401 for background bootstrap
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      headers: new Headers(),
    } as any);

    render(
      <AuthProvider>
        <AuthGate>
          <div>Protected Content</div>
        </AuthGate>
      </AuthProvider>
    );

    // Initial loading or unauthenticated form
    const input = await screen.findByPlaceholderText(/paste your token here/i);
    expect(input).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /unlock dashboard/i })).toBeInTheDocument();
    expect(screen.queryByText("Protected Content")).not.toBeInTheDocument();
  });

  it("renders AccessExpiredBanner when redirect:access-expired event is dispatched", async () => {
    render(
      <AuthProvider>
        <AccessExpiredBanner />
      </AuthProvider>
    );

    // Initially banner should not be in DOM
    expect(
      screen.queryByText(/your cloudflare zero trust session has expired/i)
    ).not.toBeInTheDocument();

    // Trigger access expired event
    act(() => {
      window.dispatchEvent(new CustomEvent("redirect:access-expired"));
    });

    // Banner should appear
    const msg = await screen.findByText(/your cloudflare zero trust session has expired/i);
    expect(msg).toBeInTheDocument();

    // Reload button should be present
    expect(screen.getByRole("button", { name: /reload/i })).toBeInTheDocument();

    // Dismiss button should dismiss banner
    const dismissBtn = screen.getByRole("button", { name: /dismiss banner/i });
    fireEvent.click(dismissBtn);
    expect(
      screen.queryByText(/your cloudflare zero trust session has expired/i)
    ).not.toBeInTheDocument();
  });
});
