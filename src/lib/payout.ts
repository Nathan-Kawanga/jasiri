// Payout sheet, one line per paid code: barber side, then service staff side.
export type Ticket = {
  code: string;
  barber: string | null;
  barber_amount: number;
  amount_paid: number | null;
  lines: { name: string; amount: number; note: string | null }[];
};

export type PersonRow = {
  user_id: string; name: string; role: string; paid_count: number; paid_amount: number; open_count: number;
  codes: { code: string; amount: number }[];
};

// Used when the database hasn't got payout_tickets yet (update 11 not run):
// rebuild the codes from the per-person sheet. Codes are unique within a shop.
export function ticketsFromPeople(rows: PersonRow[]): Ticket[] {
  const byCode = new Map<string, Ticket>();
  const get = (code: string) => {
    let t = byCode.get(code);
    if (!t) byCode.set(code, (t = { code, barber: null, barber_amount: 0, amount_paid: null, lines: [] }));
    return t;
  };
  for (const r of rows) {
    for (const c of r.codes) {
      const t = get(c.code);
      if (r.role === "barber") { t.barber = r.name; t.barber_amount = c.amount; }
      else t.lines.push({ name: r.name, amount: c.amount, note: null });
    }
  }
  return [...byCode.values()].sort((a, b) => a.code.localeCompare(b.code));
}

export const ticketTotal = (t: Ticket) => t.barber_amount + t.lines.reduce((a, l) => a + l.amount, 0);
export const ticketMismatch = (t: Ticket) => t.amount_paid !== null && t.amount_paid !== ticketTotal(t);
