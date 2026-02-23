"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useDebouncedCriticalClick } from "@/lib/use-debounced-critical-click";

export type OrderConfirmationModalProps =
  | {
      variant: "place";
      open: boolean;
      onClose: () => void;
      contractSummary: string;
      action: "BUY" | "SELL";
      quantity: number;
      orderType: string;
      limitPrice?: number;
      stopPrice?: number;
      whatIfPreview?: { commission?: string; margin?: string };
      onConfirm: () => void | Promise<void>;
      isSubmitting?: boolean;
    }
  | {
      variant: "cancel";
      open: boolean;
      onClose: () => void;
      orderId: number;
      onConfirm: () => void | Promise<void>;
      isSubmitting?: boolean;
    };

/**
 * 2-step order confirmation modal (Preview -> Confirm).
 *
 * PD-friendly design:
 * - No time-based countdowns or drag/slide-to-confirm
 * - Large buttons (min-h-[52px]) with clear labels
 * - Always-visible Cancel/Back on every step
 * - Clear escape paths (click overlay, press Escape, or Cancel button)
 */
export function OrderConfirmationModal(props: OrderConfirmationModalProps) {
  const { open, onClose, onConfirm, isSubmitting = false } = props;
  const [step, setStep] = useState<"preview" | "confirm">("preview");

  // Reset step when modal opens/closes
  const handleClose = () => {
    setStep("preview");
    onClose();
  };

  const handleConfirm = async () => {
    await onConfirm();
    setStep("preview");
  };

  // PD-friendly: prevent tremor double-tap from firing confirm twice (500ms cooldown)
  const handleConfirmDebounced = useDebouncedCriticalClick(handleConfirm, 500);

  if (props.variant === "place") {
    const {
      contractSummary,
      action,
      quantity,
      orderType,
      limitPrice,
      stopPrice,
      whatIfPreview,
    } = props;

    const actionColor = action === "BUY" ? "bg-blue-600 hover:bg-blue-500 focus:ring-blue-400" : "bg-red-600 hover:bg-red-500 focus:ring-red-400";

    return (
      <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose(); }}>
        <DialogContent className="bg-gray-900 text-gray-100 border-gray-700 max-w-md">
          <DialogHeader>
            <DialogTitle className="text-xl">
              {step === "preview" ? "Review order" : "Confirm order"}
            </DialogTitle>
          </DialogHeader>

          {/* Step indicator */}
          <div className="flex items-center gap-2 text-sm text-gray-400" aria-live="polite">
            <span className={step === "preview" ? "text-white font-semibold" : ""}>
              1. Preview
            </span>
            <span aria-hidden="true">&#8594;</span>
            <span className={step === "confirm" ? "text-white font-semibold" : ""}>
              2. Confirm
            </span>
          </div>

          {/* Order details (shown on both steps) */}
          <div className="space-y-3 py-2 text-base">
            <div className="bg-gray-800 rounded-lg px-4 py-3">
              <div className="text-gray-400 mb-1 text-sm">Contract</div>
              <div className="font-mono text-gray-200">{contractSummary}</div>
            </div>
            <div className="grid grid-cols-2 gap-3 text-gray-300">
              <span className="text-gray-500">Action</span>
              <span className={`font-bold ${action === "BUY" ? "text-blue-400" : "text-red-400"}`}>
                {action}
              </span>
              <span className="text-gray-500">Quantity</span>
              <span className="tabular-nums font-semibold text-white">{quantity}</span>
              <span className="text-gray-500">Order type</span>
              <span>{orderType}</span>
              {limitPrice != null && (
                <>
                  <span className="text-gray-500">Limit price</span>
                  <span className="tabular-nums font-semibold text-white">{limitPrice.toFixed(2)}</span>
                </>
              )}
              {stopPrice != null && (
                <>
                  <span className="text-gray-500">Stop price</span>
                  <span className="tabular-nums font-semibold text-white">{stopPrice.toFixed(2)}</span>
                </>
              )}
            </div>
            {whatIfPreview && (whatIfPreview.commission || whatIfPreview.margin) && (
              <div className="bg-gray-800/50 rounded-lg px-4 py-3 text-sm text-gray-400">
                {whatIfPreview.commission && <div>Commission: {whatIfPreview.commission}</div>}
                {whatIfPreview.margin && <div>Margin: {whatIfPreview.margin}</div>}
              </div>
            )}
          </div>

          {step === "confirm" && (
            <div className="rounded-lg border-2 border-amber-600/60 bg-amber-900/20 px-4 py-3 text-base text-amber-200">
              Are you sure you want to {action.toLowerCase()} {quantity} {contractSummary}?
            </div>
          )}

          <DialogFooter className="flex flex-col gap-3 sm:flex-col">
            {step === "preview" ? (
              <>
                <Button
                  type="button"
                  onClick={() => setStep("confirm")}
                  className={`w-full min-h-[52px] text-lg font-bold text-white ${actionColor} focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-900`}
                >
                  Preview &#8594; Confirm
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleClose}
                  className="w-full min-h-[52px] text-lg border-gray-600 text-gray-200 hover:bg-gray-800 focus:ring-2 focus:ring-gray-400 focus:ring-offset-2 focus:ring-offset-gray-900"
                >
                  Cancel
                </Button>
              </>
            ) : (
              <>
                <Button
                  type="button"
                  onClick={handleConfirmDebounced}
                  disabled={isSubmitting}
                  className={`w-full min-h-[52px] text-lg font-bold text-white ${actionColor} focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-900`}
                >
                  {isSubmitting ? "Sending…" : `${action} ${quantity} — Send order`}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setStep("preview")}
                  className="w-full min-h-[52px] text-lg border-gray-600 text-gray-200 hover:bg-gray-800 focus:ring-2 focus:ring-gray-400 focus:ring-offset-2 focus:ring-offset-gray-900"
                >
                  &#8592; Back
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleClose}
                  className="w-full min-h-[44px] text-base border-gray-700 text-gray-400 hover:bg-gray-800 hover:text-gray-200 focus:ring-2 focus:ring-gray-400 focus:ring-offset-2 focus:ring-offset-gray-900"
                >
                  Cancel order
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  // ── Cancel order variant ──
  const { orderId } = props;
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose(); }}>
      <DialogContent className="bg-gray-900 text-gray-100 border-gray-700 max-w-md">
        <DialogHeader>
          <DialogTitle className="text-xl">Cancel order</DialogTitle>
        </DialogHeader>
        <div className="py-3 text-base text-gray-300">
          Cancel order <span className="font-mono tabular-nums font-semibold text-white">{orderId}</span>?
          <span className="block mt-2 text-amber-300 text-sm">
            This cannot be undone if the order has already filled.
          </span>
        </div>
        <DialogFooter className="flex flex-col gap-3 sm:flex-col">
          <Button
            type="button"
            onClick={handleConfirmDebounced}
            disabled={isSubmitting}
            className="w-full min-h-[52px] text-lg font-bold bg-amber-600 hover:bg-amber-500 text-white focus:ring-2 focus:ring-amber-400 focus:ring-offset-2 focus:ring-offset-gray-900"
          >
            {isSubmitting ? "Cancelling…" : "Yes, cancel order"}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={handleClose}
            className="w-full min-h-[52px] text-lg border-gray-600 text-gray-200 hover:bg-gray-800 focus:ring-2 focus:ring-gray-400 focus:ring-offset-2 focus:ring-offset-gray-900"
          >
            Back — keep order
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
