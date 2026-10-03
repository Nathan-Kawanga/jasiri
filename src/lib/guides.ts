// One-page plain-English guide per role. Kept with the strings so it can be translated too.
export type Guide = { title: string; who: string; steps: { h: string; p: string }[]; rules: string[] };

export const guides: Record<string, Guide> = {
  barber: {
    title: "Barber",
    who: "You cut. Every client you serve gets a code from your phone. That code is your proof of work.",
    steps: [
      { h: "1. After the cut, tap New code", p: "Pick the client: Returning (search name or last digits), New (hand him the phone to type his name and number and tick the box), or No details if he refuses. From your day view, Start code on a booking picks him for you." },
      { h: "2. Type what you charged", p: "Type the amount in KES, then Make code." },
      { h: "3. The client taps Confirm my code", p: "Show him the screen. His tap opens the code. The app tells you which service lady to send him to. The cashier can see the code at the same moment." },
      { h: "4. Check your earnings", p: "My earnings shows Cashier-confirmed codes (the client paid) and Self-recorded ones (not paid yet). Download Excel or PDF to hand to your boss." },
      { h: "5. Your client book and booking link", p: "Clients who give their number go into your client book. It is yours: if you move shops it moves with you. Set Bookable times, then share your link from Booking link (copy, WhatsApp reply, QR code for your mirror)." },
    ],
    rules: [
      "No code, no record. Make a code for every client.",
      "You can cancel a code only before the client taps Confirm. After that only the cashier or shop manager can void it.",
      "Nobody can move your code to another barber. Not the manager, not the cashier.",
      "Your free month starts when you sign up. After that you will see how to pay.",
    ],
  },
  service_staff: {
    title: "Service staff",
    who: "You do head washes, massages and facials. Clients come to you with a code from their barber.",
    steps: [
      { h: "1. Start my day", p: "Open My queue and tap Start my day so codes come to you. Tap Go off duty when you leave. It resets at midnight." },
      { h: "2. A code arrives", p: "It appears in Sent to me by itself. If nobody was on duty, it waits in Unassigned: tap Take." },
      { h: "3. The client taps to confirm", p: "Open the code when he reaches you and let him tap Client: tap to confirm." },
      { h: "4. Type what you charged", p: "Add each service with its amount (the head wash, then any extras). Tap Done – send to cashier." },
      { h: "5. Other cases", p: "Client leaves without any service: No service. Someone else will do it: Hand to a colleague. Client only wants your services, no haircut: New service-only code." },
    ],
    rules: [
      "If the client goes straight to the cashier and pays, nothing is recorded for you on that code.",
      "My earnings shows every code you worked on. Use Report a problem if something is wrong.",
    ],
  },
  cashier: {
    title: "Cashier",
    who: "You take the money. You never type who did the work; the codes already say it.",
    steps: [
      { h: "1. Open Cashier", p: "Open codes appear by themselves with the barber, the service lady and the total they typed." },
      { h: "2. Client pays you", p: "Cash or M-Pesa, as he likes. The app does not record how he paid." },
      { h: "3. Type what he actually paid", p: "Tap his code, type the amount (or tap Same as total), then let the client tap the green button to confirm. That tap marks the code paid. It happens once." },
      { h: "4. Voids", p: "If a client leaves without paying, or a code is a mistake or duplicate, tap Void and pick a reason. Voids are counted per person." },
      { h: "5. End of day", p: "Daily summary shows what the till should hold. Payout sheet lists every person's paid codes; print it or download it." },
    ],
    rules: [
      "Paid and voided codes can never be changed.",
      "Codes left open at midnight stay open and are flagged. They are evidence, not mistakes to hide.",
      "The cashier account can be passed to the next cashier with its email and PIN.",
    ],
  },
  manager: {
    title: "Shop manager",
    who: "You set up the shop and let people in. You can also be a barber, service staff or cashier.",
    steps: [
      { h: "1. Invite people", p: "Manage shop shows the join code and invite link. People who ask to join get nothing until you approve them and pick their roles." },
      { h: "2. Change roles or remove someone", p: "Tick the roles and Save roles, or Remove from shop. Give another person the Shop manager role before you leave." },
      { h: "3. Watch the flags", p: "Flags show codes left unpaid after their day, paid amounts that differ from what staff typed, voids per person, handovers, and codes voided then remade under a different barber." },
      { h: "4. Problems and audit log", p: "Staff reports land in Problems. The Audit log shows every action: who, which role, what and when. Nobody can edit it." },
      { h: "5. Usage", p: "Usage shows how many codes carry a phone number, how many reach paid, booking link use and no-shows." },
    ],
    rules: [
      "You can't see client phone numbers. They belong to each barber.",
      "You can't change the barber on any code.",
    ],
  },
};
