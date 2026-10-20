import { Check, CheckCheck, Clock, AlertCircle } from 'lucide-react';
import type { MessageStatus } from '@chatgram/core';

/**
 * WhatsApp-style delivery ticks.
 *   sent      → single grey tick
 *   delivered → double grey tick
 *   read      → double teal tick
 */
export function MessageTicks({ status, className = '' }: { status: MessageStatus; className?: string }) {
  if (status === 'sending') {
    return <Clock className={`h-3.5 w-3.5 text-white/60 ${className}`} aria-label="Sending" />;
  }
  if (status === 'failed') {
    return <AlertCircle className={`h-3.5 w-3.5 text-rose-300 ${className}`} aria-label="Not sent" />;
  }
  if (status === 'sent') {
    return <Check className={`h-3.5 w-3.5 text-white/60 ${className}`} aria-label="Sent" />;
  }
  // delivered / read
  return (
    <CheckCheck
      className={`h-3.5 w-3.5 ${status === 'read' ? 'text-[#53bdeb]' : 'text-white/60'} ${className}`}
      aria-label={status === 'read' ? 'Read' : 'Delivered'}
    />
  );
}
