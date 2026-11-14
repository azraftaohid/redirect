import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const mockImportLinksChunked = vi.fn();

vi.mock("@/api/client", async () => {
  const actual = await vi.importActual<typeof import("@/api/client")>("@/api/client");
  return {
    ...actual,
    importLinksChunked: (...args: any[]) => mockImportLinksChunked(...args),
  };
});

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
  },
}));

import { ImportChunkError } from "@/api/client";
import { ImportLinksModal } from "../src/components/ImportLinksModal";

function createJsonFile(payload: unknown, name = "export.json"): File {
  const text = JSON.stringify(payload);
  const file = new File([text], name, { type: "application/json" });
  Object.defineProperty(file, "text", {
    value: async () => text,
  });
  return file;
}

describe("ImportLinksModal", () => {
  beforeEach(() => {
    mockImportLinksChunked.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("uploads JSON, allows selecting overwrite mode, displays report, and calls onSuccess", async () => {
    const onSuccess = vi.fn();
    const onClose = vi.fn();

    mockImportLinksChunked.mockResolvedValue({
      version: 1,
      onConflict: "overwrite",
      summary: { total: 2, created: 1, updated: 1, skipped: 0, failed: 0 },
      skippedSlugs: [],
      createdSlugs: ["new-link"],
      updatedSlugs: ["existing-link"],
      errors: [],
      results: [
        { index: 0, slug: "new-link", status: "created", id: "id-1" },
        { index: 1, slug: "existing-link", status: "updated", id: "id-2" },
      ],
    });

    render(<ImportLinksModal isOpen={true} onClose={onClose} onSuccess={onSuccess} />);

    const fileInput = screen.getByLabelText("Export File (.json)") as HTMLInputElement;
    const file = createJsonFile({
      version: 1,
      links: [
        { slug: "new-link", targetUrl: "https://example.com/1" },
        { slug: "existing-link", targetUrl: "https://example.com/2" },
      ],
    });
    fireEvent.change(fileInput, { target: { files: [file] } });

    await screen.findByText(/Loaded 2 link\(s\) from export\.json\./i);

    const overwriteRadio = screen.getByRole("radio", { name: /Overwrite existing/i });
    fireEvent.click(overwriteRadio);

    const submitButton = screen.getByRole("button", { name: /Import Links/i });
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(mockImportLinksChunked).toHaveBeenCalledWith(
        [
          { slug: "new-link", targetUrl: "https://example.com/1" },
          { slug: "existing-link", targetUrl: "https://example.com/2" },
        ],
        expect.objectContaining({ onConflict: "overwrite" })
      );
    });

    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("Created")).toBeInTheDocument();
    expect(screen.getByText("Updated")).toBeInTheDocument();
  });

  it("distinguishes existing collisions vs duplicate_in_batch in skipped slugs report", async () => {
    mockImportLinksChunked.mockResolvedValue({
      version: 1,
      onConflict: "skip",
      summary: { total: 3, created: 1, updated: 0, skipped: 2, failed: 0 },
      skippedSlugs: ["existing-slug", "dup-slug"],
      createdSlugs: ["dup-slug"],
      updatedSlugs: [],
      errors: [],
      results: [
        { index: 0, slug: "existing-slug", status: "skipped", reason: "slug_exists" },
        { index: 1, slug: "dup-slug", status: "created", id: "id-1" },
        { index: 2, slug: "dup-slug", status: "skipped", reason: "duplicate_in_batch" },
      ],
    });

    render(<ImportLinksModal isOpen={true} onClose={vi.fn()} onSuccess={vi.fn()} />);

    const fileInput = screen.getByLabelText("Export File (.json)");
    const file = createJsonFile({
      version: 1,
      links: [
        { slug: "existing-slug", targetUrl: "https://example.com/1" },
        { slug: "dup-slug", targetUrl: "https://example.com/2" },
        { slug: "dup-slug", targetUrl: "https://example.com/3" },
      ],
    });
    fireEvent.change(fileInput, { target: { files: [file] } });

    await screen.findByText(/Loaded 3 link\(s\)/i);
    fireEvent.click(screen.getByRole("button", { name: /Import Links/i }));

    expect(await screen.findByText(/Skipped Slugs \(2\)/i)).toBeInTheDocument();
    expect(screen.getByText("/existing-slug")).toBeInTheDocument();
    expect(screen.getByText("/dup-slug")).toBeInTheDocument();
    expect(screen.getByText("(duplicate in file)")).toBeInTheDocument();
  });

  it("renders partial progress banner and refreshes links when a chunk fails mid-import", async () => {
    const onSuccess = vi.fn();
    mockImportLinksChunked.mockRejectedValue(
      new ImportChunkError(
        "Import interrupted at chunk 2/2 (1 of 2 links processed): Network down",
        {
          version: 1,
          onConflict: "skip",
          summary: { total: 1, created: 1, updated: 0, skipped: 0, failed: 0 },
          skippedSlugs: [],
          createdSlugs: ["first-ok"],
          updatedSlugs: [],
          errors: [],
          results: [{ index: 0, slug: "first-ok", status: "created", id: "id-1" }],
        },
        new Error("Network down")
      )
    );

    render(<ImportLinksModal isOpen={true} onClose={vi.fn()} onSuccess={onSuccess} />);

    const fileInput = screen.getByLabelText("Export File (.json)");
    const file = createJsonFile({
      version: 1,
      links: [
        { slug: "first-ok", targetUrl: "https://example.com/1" },
        { slug: "second-fail", targetUrl: "https://example.com/2" },
      ],
    });
    fireEvent.change(fileInput, { target: { files: [file] } });

    await screen.findByText(/Loaded 2 link\(s\)/i);
    fireEvent.click(screen.getByRole("button", { name: /Import Links/i }));

    expect(
      await screen.findByText(/Import interrupted before completing all chunks/i)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Import interrupted at chunk 2\/2/i)
    ).toBeInTheDocument();
    expect(onSuccess).toHaveBeenCalledTimes(1);
  });
});
