"use client";

import { useEffect, useState } from "react";
import {
  getSenderState,
  onSenderStateChange,
  type SenderState,
} from "@/lib/sender-state";

interface Props {
  fromEmail: string | null;
}

const VARIANTS: Record<
  SenderState,
  { label: string; bg: string; fg: string; dot: string }
> = {
  subscribed: {
    label: "Subscribed",
    bg: "bg-[#F2EDE2]",
    fg: "text-[#564B40]",
    dot: "#9C7847",
  },
  unsubscribed: {
    label: "Unsubscribed",
    bg: "bg-[#3D362F]",
    fg: "text-[#FBFAF7]",
    dot: "#9C9189",
  },
  resubscribed: {
    label: "Resubscribed",
    bg: "bg-[#5C8A4F]",
    fg: "text-white",
    dot: "#FBFAF7",
  },
};

export function SenderStatusBadge({ fromEmail }: Props) {
  // Initial value matches server render (everything looks "subscribed"). After
  // mount we read localStorage and update — single-frame flash is fine.
  const [state, setState] = useState<SenderState>("subscribed");

  useEffect(() => {
    setState(getSenderState(fromEmail));
    return onSenderStateChange(() => setState(getSenderState(fromEmail)));
  }, [fromEmail]);

  const v = VARIANTS[state];
  return (
    <span
      className={`text-[10px] font-semibold ${v.bg} ${v.fg} px-2 py-0.5 rounded-full whitespace-nowrap inline-flex items-center gap-1.5`}
      title={`You marked this sender as ${state}`}
    >
      <span
        className="inline-block w-1.5 h-1.5 rounded-full"
        style={{ background: v.dot }}
      />
      {v.label}
    </span>
  );
}
