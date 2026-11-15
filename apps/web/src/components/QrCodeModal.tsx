import React, { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  generateQrSvg,
  generateQrPngBlob,
  downloadBlob,
  copyImageBlobToClipboard,
} from "@/utils/qr";
import { Download, Copy, Check, Loader2, QrCode } from "lucide-react";
import { toast } from "sonner";

interface QrCodeModalProps {
  isOpen: boolean;
  onClose: () => void;
  slug: string;
  targetUrl: string;
}

export function QrCodeModal({
  isOpen,
  onClose,
  slug,
  targetUrl,
}: QrCodeModalProps): React.ReactElement {
  const [svgContent, setSvgContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [copiedImg, setCopiedImg] = useState(false);
  const [downloadingPng, setDownloadingPng] = useState(false);
  const [copyingImg, setCopyingImg] = useState(false);

  const shortUrl = typeof window !== "undefined" ? `${window.location.origin}/${slug}` : `/${slug}`;

  useEffect(() => {
    if (!isOpen || !slug) return;

    let active = true;
    setLoading(true);

    generateQrSvg(shortUrl)
      .then((svg) => {
        if (!active) return;
        setSvgContent(svg);
        setLoading(false);
      })
      .catch((err) => {
        if (!active) return;
        setLoading(false);
        toast.error("Failed to generate QR code: " + (err instanceof Error ? err.message : String(err)));
      });

    return () => {
      active = false;
    };
  }, [isOpen, slug, shortUrl]);

  async function handleDownloadPng() {
    setDownloadingPng(true);
    try {
      const blob = await generateQrPngBlob(shortUrl, 1024);
      downloadBlob(blob, `${slug}-qr.png`);
      toast.success("Downloaded PNG QR code");
    } catch (err) {
      toast.error("Failed to generate PNG: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setDownloadingPng(false);
    }
  }

  function handleDownloadSvg() {
    if (!svgContent) return;
    const blob = new Blob([svgContent], { type: "image/svg+xml;charset=utf-8" });
    downloadBlob(blob, `${slug}-qr.svg`);
    toast.success("Downloaded SVG QR code");
  }

  async function handleCopyImage() {
    setCopyingImg(true);
    try {
      const blob = await generateQrPngBlob(shortUrl, 1024);
      const success = await copyImageBlobToClipboard(blob);
      if (success) {
        setCopiedImg(true);
        toast.success("QR code copied to clipboard");
        setTimeout(() => setCopiedImg(false), 2000);
      } else {
        toast.error("Clipboard image copy not supported by your browser");
      }
    } catch (err) {
      toast.error("Failed to copy image to clipboard: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setCopyingImg(false);
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="w-[calc(100%-2rem)] sm:w-full sm:max-w-lg">
        <DialogHeader className="min-w-0">
          <DialogTitle className="flex items-center gap-2 min-w-0">
            <QrCode className="w-5 h-5 shrink-0" />
            <span className="truncate">QR Code: /{slug}</span>
          </DialogTitle>
          <DialogDescription className="truncate text-xs">
            Directs to {targetUrl}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col items-center justify-center p-4">
          <div className="w-64 h-64 max-w-full aspect-square bg-white p-3 rounded-xl border border-zinc-200 dark:border-zinc-800 shadow-xs flex items-center justify-center">
            {loading ? (
              <Loader2 className="w-8 h-8 animate-spin text-zinc-400" />
            ) : svgContent ? (
              <img
                src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgContent)}`}
                alt={`QR code for /${slug}`}
                className="w-full h-full object-contain"
              />
            ) : (
              <span className="text-xs text-zinc-400">Unable to render preview</span>
            )}
          </div>
          <p className="mt-3 max-w-full break-all text-center font-mono text-xs text-zinc-500 dark:text-zinc-400 select-all">
            {shortUrl}
          </p>
        </div>

        <DialogFooter className="grid grid-cols-1 sm:grid-cols-3 gap-2 sm:gap-2 sm:space-x-0">
          <Button
            variant="outline"
            size="sm"
            onClick={handleCopyImage}
            disabled={loading || copyingImg}
            className="w-full min-w-0 gap-1.5"
            title="Copy QR code PNG image to clipboard"
          >
            {copiedImg ? (
              <Check className="w-4 h-4 shrink-0 text-emerald-600" />
            ) : (
              <Copy className="w-4 h-4 shrink-0" />
            )}
            <span>{copyingImg ? "Copying..." : "Copy Image"}</span>
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={handleDownloadSvg}
            disabled={loading || !svgContent}
            className="w-full min-w-0 gap-1.5"
            title="Download vector SVG QR code"
          >
            <Download className="w-4 h-4 shrink-0" />
            <span>Download SVG</span>
          </Button>

          <Button
            size="sm"
            onClick={handleDownloadPng}
            disabled={loading || downloadingPng}
            className="w-full min-w-0 gap-1.5"
            title="Download 1024×1024px PNG QR code"
          >
            <Download className="w-4 h-4 shrink-0" />
            <span>{downloadingPng ? "Generating..." : "Download PNG"}</span>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
