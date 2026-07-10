-- Add a session realized-P&L accumulator to the single account row.
-- Closing fills add their realized gain/loss here inside the settlement tx,
-- satisfying plan §8 ("realized P&L accumulates from closing fills").

ALTER TABLE account ADD COLUMN realized_pnl REAL NOT NULL DEFAULT 0;
