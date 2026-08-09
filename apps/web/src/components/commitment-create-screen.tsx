"use client";

import Link from "next/link";

import { CommitmentForm } from "@/components/commitment-form";
import { useSelectedHousehold } from "@/components/household-scope";

export function CommitmentCreateScreen() {
  const household = useSelectedHousehold();
  return (
    <div className="commitment-editor-page">
      <header className="resource-heading">
        <div>
          <Link
            className="back-link"
            href={`/commitments?householdId=${encodeURIComponent(household.id)}`}
          >
            ← All commitments
          </Link>
          <p className="eyebrow">Manual entry</p>
          <h1>Add a recurring commitment</h1>
          <p>
            Use fictional data in this local environment. AutoPay Guard records
            what you enter but never initiates a payment.
          </p>
        </div>
      </header>
      <CommitmentForm household={household} key={household.id} />
    </div>
  );
}
