# Project guidance
Read [DESIGN.md](DESIGN.md) before interface changes. Preserve its quiet-library visual identity. Never request microphone or camera permission. Keep usage diagnostics owner-only. Quota reservations and room changes must be serialized server-side. Never bypass a latched pause on cycle rollover. Verify changes with simulated limits; never consume real quotas to test cutoffs.
