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

function createTextFile(text: string, name: string, type = "text/csv"): File {
  const file = new File([text], name, { type });
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

    const fileInput = screen.getByLabelText("Import File (.json, .csv)") as HTMLInputElement;
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

    const fileInput = screen.getByLabelText("Import File (.json, .csv)");
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

    const fileInput = screen.getByLabelText("Import File (.json, .csv)");
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

  it("imports custom JSON object with selectable array property, mapped fields, epoch timestamp, and constants", async () => {
    const onSuccess = vi.fn();
    mockImportLinksChunked.mockResolvedValue({
      version: 1,
      onConflict: "skip",
      summary: { total: 2, created: 2, updated: 0, skipped: 0, failed: 0 },
      skippedSlugs: [],
      createdSlugs: ["alpha", "beta"],
      updatedSlugs: [],
      errors: [],
      results: [
        { index: 0, slug: "alpha", status: "created", id: "id-1" },
        { index: 1, slug: "beta", status: "created", id: "id-2" },
      ],
    });

    render(<ImportLinksModal isOpen={true} onClose={vi.fn()} onSuccess={onSuccess} />);

    const fileInput = screen.getByLabelText("Import File (.json, .csv)");
    const file = createJsonFile(
      {
        unrelated: [{ foo: "bar" }],
        data: {
          records: [
            {
              dest_page: "https://example.com/a",
              short_path: "alpha",
              epoch_ts: 1735689600,
            },
            {
              dest_page: "https://example.com/b",
              short_path: "beta",
              epoch_ts: "1735689600000",
            },
          ],
        },
      },
      "custom.json"
    );
    fireEvent.change(fileInput, { target: { files: [file] } });

    const arraySelect = await screen.findByLabelText("Array Property in JSON Object");
    fireEvent.change(arraySelect, { target: { value: "data.records" } });

    fireEvent.change(screen.getByLabelText("Mapping mode for targetUrl"), {
      target: { value: "field" },
    });
    fireEvent.change(screen.getByLabelText("Source field for targetUrl"), {
      target: { value: "dest_page" },
    });

    fireEvent.change(screen.getByLabelText("Mapping mode for slug"), {
      target: { value: "field" },
    });
    fireEvent.change(screen.getByLabelText("Source field for slug"), {
      target: { value: "short_path" },
    });

    fireEvent.change(screen.getByLabelText("Mapping mode for createdAt"), {
      target: { value: "field" },
    });
    fireEvent.change(screen.getByLabelText("Source field for createdAt"), {
      target: { value: "epoch_ts" },
    });

    fireEvent.change(screen.getByLabelText("Mapping mode for statusCode"), {
      target: { value: "constant" },
    });
    fireEvent.change(screen.getByLabelText("Constant value for statusCode"), {
      target: { value: "301" },
    });

    fireEvent.change(screen.getByLabelText("Mapping mode for tags"), {
      target: { value: "constant" },
    });
    fireEvent.change(screen.getByLabelText("Constant value for tags"), {
      target: { value: "migrated, batch1" },
    });

    const previewTimestamps = await screen.findAllByText(/2025-01-01T00:00:00\.000Z/i);
    expect(previewTimestamps).toHaveLength(2);

    fireEvent.click(screen.getByRole("button", { name: /Import Links/i }));

    await waitFor(() => {
      expect(mockImportLinksChunked).toHaveBeenCalledWith(
        [
          {
            targetUrl: "https://example.com/a",
            slug: "alpha",
            statusCode: 301,
            tags: ["migrated", "batch1"],
            createdAt: "2025-01-01T00:00:00.000Z",
          },
          {
            targetUrl: "https://example.com/b",
            slug: "beta",
            statusCode: 301,
            tags: ["migrated", "batch1"],
            createdAt: "2025-01-01T00:00:00.000Z",
          },
        ],
        expect.objectContaining({ onConflict: "skip" })
      );
    });
    expect(onSuccess).toHaveBeenCalledTimes(1);
  });

  it("imports CSV with timestamps, constant override, pre-flight invalid row warnings, and preserves original row indices", async () => {
    const onSuccess = vi.fn();
    mockImportLinksChunked.mockResolvedValue({
      version: 1,
      onConflict: "skip",
      summary: { total: 2, created: 2, updated: 0, skipped: 0, failed: 0 },
      skippedSlugs: [],
      createdSlugs: ["row1", "row3"],
      updatedSlugs: [],
      errors: [],
      results: [
        { index: 0, slug: "row1", status: "created", id: "id-1" },
        { index: 1, slug: "row3", status: "created", id: "id-3" },
      ],
    });

    render(<ImportLinksModal isOpen={true} onClose={vi.fn()} onSuccess={onSuccess} />);

    const csvText = [
      "long_url,alias,expires_on",
      "https://example.com/1,row1,2030-05-01 12:00:00",
      "https://example.com/2,row2,not-a-timestamp",
      "https://example.com/3,row3,1735689600",
    ].join("\n");

    const fileInput = screen.getByLabelText("Import File (.json, .csv)");
    const csvFile = createTextFile(csvText, "links.csv", "text/csv");
    fireEvent.change(fileInput, { target: { files: [csvFile] } });

    await screen.findByText(/Loaded 3 row\(s\) from links\.csv \(CSV\)\./i);

    fireEvent.change(screen.getByLabelText("Mapping mode for expiresAt"), {
      target: { value: "field" },
    });
    fireEvent.change(screen.getByLabelText("Source field for expiresAt"), {
      target: { value: "expires_on" },
    });

    fireEvent.change(screen.getByLabelText("Mapping mode for forwardQuery"), {
      target: { value: "constant" },
    });
    fireEvent.change(screen.getByLabelText("Constant value for forwardQuery"), {
      target: { value: "false" },
    });

    expect(await screen.findByText(/Pre-flight validation warnings \(1\)/i)).toBeInTheDocument();
    expect(screen.getByText(/Row #2: expiresAt:/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Import Links/i }));

    await waitFor(() => {
      expect(mockImportLinksChunked).toHaveBeenCalledWith(
        [
          {
            targetUrl: "https://example.com/1",
            slug: "row1",
            forwardQuery: false,
            expiresAt: "2030-05-01T12:00:00.000Z",
          },
          {
            targetUrl: "https://example.com/3",
            slug: "row3",
            forwardQuery: false,
            expiresAt: "2025-01-01T00:00:00.000Z",
          },
        ],
        expect.objectContaining({ onConflict: "skip" })
      );
    });

    expect(await screen.findByText(/Failed Items \(1\)/i)).toBeInTheDocument();
    expect(screen.getByText(/Row #2/)).toBeInTheDocument();
    expect(onSuccess).toHaveBeenCalledTimes(1);
  });

  it("keeps CSV header/delimiter options accessible when a 1-row headerless CSV fails initial parse", async () => {
    mockImportLinksChunked.mockResolvedValue({
      version: 1,
      onConflict: "skip",
      summary: { total: 1, created: 1, updated: 0, skipped: 0, failed: 0 },
      skippedSlugs: [],
      createdSlugs: ["solo"],
      updatedSlugs: [],
      errors: [],
      results: [{ index: 0, slug: "solo", status: "created", id: "id-1" }],
    });

    render(<ImportLinksModal isOpen={true} onClose={vi.fn()} onSuccess={vi.fn()} />);

    const fileInput = screen.getByLabelText("Import File (.json, .csv)");
    const singleRowCsv = createTextFile("https://example.com/solo,solo", "single.csv");
    fireEvent.change(fileInput, { target: { files: [singleRowCsv] } });

    expect(
      await screen.findByText(/CSV file contains a header row but no data rows\./i)
    ).toBeInTheDocument();

    const headerCheckbox = screen.getByRole("checkbox", {
      name: /First row contains headers/i,
    });
    fireEvent.click(headerCheckbox);

    await screen.findByText(/Loaded 1 row\(s\) from single\.csv \(CSV\)\./i);

    fireEvent.change(screen.getByLabelText("Mapping mode for targetUrl"), {
      target: { value: "field" },
    });
    fireEvent.change(screen.getByLabelText("Source field for targetUrl"), {
      target: { value: "Column 1" },
    });
    fireEvent.change(screen.getByLabelText("Mapping mode for slug"), {
      target: { value: "field" },
    });
    fireEvent.change(screen.getByLabelText("Source field for slug"), {
      target: { value: "Column 2" },
    });

    fireEvent.click(screen.getByRole("button", { name: /Import Links/i }));

    await waitFor(() => {
      expect(mockImportLinksChunked).toHaveBeenCalledWith(
        [{ targetUrl: "https://example.com/solo", slug: "solo" }],
        expect.any(Object)
      );
    });
  });

  it("routes version=1 JSON with non-native link items to dynamic field mapping instead of fast path", async () => {
    render(<ImportLinksModal isOpen={true} onClose={vi.fn()} onSuccess={vi.fn()} />);

    const fileInput = screen.getByLabelText("Import File (.json, .csv)");
    const foreignV1File = createJsonFile(
      {
        version: 1,
        links: [{ url: "https://example.com/custom", alias: "custom-1" }],
      },
      "foreign-v1.json"
    );
    fireEvent.change(fileInput, { target: { files: [foreignV1File] } });

    expect(
      await screen.findByText(/Loaded 1 row\(s\) from foreign-v1\.json \(JSON\)\./i)
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Source field for targetUrl")).toHaveValue("url");
    expect(screen.getByLabelText("Source field for slug")).toHaveValue("alias");
  });

  it("clears stale parseError when toggling back from custom mapping on native JSON v1 export", async () => {
    render(<ImportLinksModal isOpen={true} onClose={vi.fn()} onSuccess={vi.fn()} />);

    const fileInput = screen.getByLabelText("Import File (.json, .csv)");
    const file = createJsonFile({
      version: 1,
      otherEmpty: [],
      links: [{ slug: "native-1", targetUrl: "https://example.com/native" }],
    });
    fireEvent.change(fileInput, { target: { files: [file] } });

    await screen.findByText(/Loaded 1 link\(s\) from export\.json\./i);

    fireEvent.click(screen.getByRole("button", { name: /Customize mapping & constants/i }));
    const arraySelect = await screen.findByLabelText("Array Property in JSON Object");
    fireEvent.change(arraySelect, { target: { value: "otherEmpty" } });

    expect(
      await screen.findByText(/The 'otherEmpty' array in this JSON file is empty\./i)
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Import Links/i })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: /Use standard export mapping/i }));

    await waitFor(() => {
      expect(
        screen.queryByText(/The 'otherEmpty' array in this JSON file is empty\./i)
      ).not.toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: /Import Links/i })).toBeEnabled();
  });

  it("stays on mapping form when chunk 1 fails in mapped mode even with pre-flight clientErrors", async () => {
    mockImportLinksChunked.mockRejectedValue(
      new ImportChunkError(
        "Import interrupted at chunk 1/1 (0 of 1 links processed): Network down",
        {
          version: 1,
          onConflict: "skip",
          summary: { total: 0, created: 0, updated: 0, skipped: 0, failed: 0 },
          skippedSlugs: [],
          createdSlugs: [],
          updatedSlugs: [],
          errors: [],
          results: [],
        },
        new Error("Network down")
      )
    );

    render(<ImportLinksModal isOpen={true} onClose={vi.fn()} onSuccess={vi.fn()} />);

    const csvText = [
      "long_url,slug",
      "not-a-url,bad-row",
      "https://example.com/good,good-row",
    ].join("\n");

    const fileInput = screen.getByLabelText("Import File (.json, .csv)");
    fireEvent.change(fileInput, {
      target: { files: [createTextFile(csvText, "mixed.csv", "text/csv")] },
    });

    expect(await screen.findByText(/Pre-flight validation warnings \(1\)/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Import Links/i }));

    expect(await screen.findByText(/Network down/i)).toBeInTheDocument();
    expect(screen.getByLabelText("Mapping mode for targetUrl")).toBeInTheDocument();
    expect(screen.queryByText(/Failed Items/i)).not.toBeInTheDocument();
  });
});
