import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const mockGenerateQrSvg = vi.fn();
const mockGenerateQrPngBlob = vi.fn();
const mockDownloadBlob = vi.fn();
const mockCopyImageBlobToClipboard = vi.fn();

vi.mock("@/utils/qr", () => ({
  generateQrSvg: (...args: any[]) => mockGenerateQrSvg(...args),
  generateQrPngBlob: (...args: any[]) => mockGenerateQrPngBlob(...args),
  downloadBlob: (...args: any[]) => mockDownloadBlob(...args),
  copyImageBlobToClipboard: (...args: any[]) => mockCopyImageBlobToClipboard(...args),
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

import { QrCodeModal } from "../src/components/QrCodeModal";

describe("QrCodeModal", () => {
  beforeEach(() => {
    mockGenerateQrSvg.mockResolvedValue('<svg viewBox="0 0 10 10"><rect width="10" height="10"/></svg>');
    mockGenerateQrPngBlob.mockResolvedValue(new Blob(["png"], { type: "image/png" }));
    mockCopyImageBlobToClipboard.mockResolvedValue(true);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("renders three equal-width grid action buttons inside the dialog footer and triggers export/copy actions", async () => {
    render(
      <QrCodeModal
        isOpen={true}
        onClose={vi.fn()}
        slug="docs"
        targetUrl="https://example.com/docs"
      />
    );

    const copyBtn = await screen.findByRole("button", { name: /Copy Image/i });
    const svgBtn = screen.getByRole("button", { name: /Download SVG/i });
    const pngBtn = screen.getByRole("button", { name: /Download PNG/i });

    await waitFor(() => {
      expect(copyBtn).not.toBeDisabled();
      expect(svgBtn).not.toBeDisabled();
      expect(pngBtn).not.toBeDisabled();
    });

    const previewImg = screen.getByRole("img", { name: "QR code for /docs" });
    expect(previewImg.getAttribute("src")).toContain("data:image/svg+xml;charset=utf-8,");

    const dialog = screen.getByRole("dialog");
    expect(dialog.className).toContain("sm:max-w-lg");
    expect(dialog.className).not.toContain("sm:max-w-md");

    const footer = copyBtn.parentElement!;
    expect(footer.className).toContain("grid");
    expect(footer.className).toContain("sm:grid-cols-3");
    expect(footer.className).toContain("sm:space-x-0");
    expect(footer.className).toContain("sm:gap-2");

    expect(copyBtn.className).toContain("w-full");
    expect(svgBtn.className).toContain("w-full");
    expect(pngBtn.className).toContain("w-full");

    fireEvent.click(svgBtn);
    expect(mockDownloadBlob).toHaveBeenCalledWith(expect.any(Blob), "docs-qr.svg");

    fireEvent.click(pngBtn);
    await waitFor(() => {
      expect(mockDownloadBlob).toHaveBeenCalledWith(expect.any(Blob), "docs-qr.png");
    });

    fireEvent.click(copyBtn);
    await waitFor(() => {
      expect(mockCopyImageBlobToClipboard).toHaveBeenCalledTimes(1);
    });
  });
});
