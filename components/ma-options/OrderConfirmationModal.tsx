"use client";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

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

export function OrderConfirmationModal(props: OrderConfirmationModalProps) {
  const { open, onClose, onConfirm, isSubmitting = false } = props;

  const handleConfirm = async () => {
    await onConfirm();
  };

  if (props.variant === "place") {
    const {
      contractSummary,
      action,
      quantity,
      orderType,
      limitPrice,
      whatIfPreview,
    } = props;
    return (
      <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="bg-gray-900 text-gray-100 border-gray-700 max-w-md">
          <DialogHeader>
            <DialogTitle>Confirm order</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2 text-sm">
            <div className="bg-gray-800 rounded px-3 py-2">
              <div className="text-gray-400 mb-1">Contract</div>
              <div className="font-mono text-gray-200">{contractSummary}</div>
            </div>
            <div className="grid grid-cols-2 gap-2 text-gray-300">
              <span className="text-gray-500">Action</span>
              <span className="font-medium">{action}</span>
              <span className="text-gray-500">Quantity</span>
              <span className="tabular-nums">{quantity}</span>
              <span className="text-gray-500">Order type</span>
              <span>{orderType}</span>
              {limitPrice != null && (
                <>
                  <span className="text-gray-500">Limit price</span>
                  <span className="tabular-nums">{limitPrice.toFixed(2)}</span>
                </>
              )}
            </div>
            {whatIfPreview && (whatIfPreview.commission || whatIfPreview.margin) && (
              <div className="bg-gray-800/50 rounded px-3 py-2 text-xs text-gray-400">
                {whatIfPreview.commission && <div>Commission: {whatIfPreview.commission}</div>}
                {whatIfPreview.margin && <div>Margin: {whatIfPreview.margin}</div>}
              </div>
            )}
          </div>
          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              className="border-gray-600 text-gray-200 hover:bg-gray-800"
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={handleConfirm}
              disabled={isSubmitting}
              className="bg-blue-600 hover:bg-blue-700 text-white"
            >
              {isSubmitting ? "Sending…" : "Send order"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  const { orderId } = props;
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="bg-gray-900 text-gray-100 border-gray-700 max-w-md">
        <DialogHeader>
          <DialogTitle>Cancel order</DialogTitle>
        </DialogHeader>
        <div className="py-2 text-sm text-gray-300">
          Cancel order <span className="font-mono tabular-nums">{orderId}</span>? This cannot be
          undone if the order has already filled.
        </div>
        <DialogFooter className="gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            className="border-gray-600 text-gray-200 hover:bg-gray-800"
          >
            Back
          </Button>
          <Button
            type="button"
            onClick={handleConfirm}
            disabled={isSubmitting}
            className="bg-amber-600 hover:bg-amber-700 text-white"
          >
            {isSubmitting ? "Cancelling…" : "Cancel order"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
