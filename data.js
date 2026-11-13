// V.E.R.A. Seed Data & State
(function () {
  const today = new Date();
  const iso = (d) => new Date(d).toISOString();
  const day = (offset, hour = 8) => {
    const d = new Date(today);
    d.setDate(d.getDate() + offset);
    d.setHours(hour, 0, 0, 0);
    return d.toISOString();
  };

  const vehicles = [
    { id: 'v1', name: 'Toyota Vios 1.3 E', type: 'car', brand: 'Toyota', model: 'Vios 1.3 E', year: 2022, plateNumber: 'NCR 1234', ratePerDay: 1800, ratePerHour: 150, status: 'available', imageEmoji: '🚗', color: 'Silver', seats: 5, transmission: 'Automatic' },
    { id: 'v2', name: 'Honda Click 125i', type: 'motorcycle', brand: 'Honda', model: 'Click 125i', year: 2023, plateNumber: 'NCR 5678', ratePerDay: 500, ratePerHour: 60, status: 'available', imageEmoji: '🛵', color: 'Red', seats: 2, transmission: 'Automatic' },
    { id: 'v3', name: 'Yamaha Mio Gravis', type: 'motorcycle', brand: 'Yamaha', model: 'Mio Gravis', year: 2021, plateNumber: 'NCR 9012', ratePerDay: 450, ratePerHour: 55, status: 'rented', imageEmoji: '🏍️', color: 'Matte Black', seats: 2, transmission: 'Automatic' },
    { id: 'v4', name: 'Mitsubishi Mirage G4', type: 'car', brand: 'Mitsubishi', model: 'Mirage G4', year: 2020, plateNumber: 'NCR 3456', ratePerDay: 1600, ratePerHour: 140, status: 'available', imageEmoji: '🚘', color: 'White', seats: 5, transmission: 'Manual' },
    { id: 'v5', name: 'Honda TMX Supremo', type: 'motorcycle', brand: 'Honda', model: 'TMX Supremo', year: 2019, plateNumber: 'NCR 7890', ratePerDay: 400, ratePerHour: 50, status: 'maintenance', imageEmoji: '🛵', color: 'Blue', seats: 2, transmission: 'Manual' },
    { id: 'v6', name: 'Toyota Avanza', type: 'car', brand: 'Toyota', model: 'Avanza 1.3 E', year: 2021, plateNumber: 'NCR 2468', ratePerDay: 2200, ratePerHour: 180, status: 'available', imageEmoji: '🚙', color: 'Bronze', seats: 7, transmission: 'Automatic' },
    { id: 'v7', name: 'Suzuki Raider R150', type: 'motorcycle', brand: 'Suzuki', model: 'Raider R150', year: 2022, plateNumber: 'NCR 1357', ratePerDay: 550, ratePerHour: 65, status: 'malfunction', imageEmoji: '🏍️', color: 'Blue', seats: 2, transmission: 'Manual' },
    { id: 'v8', name: 'Kia Soluto', type: 'car', brand: 'Kia', model: 'Soluto LX', year: 2023, plateNumber: 'NCR 8642', ratePerDay: 1700, ratePerHour: 145, status: 'available', imageEmoji: '🚗', color: 'Red', seats: 5, transmission: 'Automatic' }
  ];

  const customers = [
    { id: 'c1', name: 'Juan Dela Cruz', email: 'juan.delacruz@email.com', phone: '0917-123-4567', totalRentals: 5, joinedAt: '2025-03-12T08:00:00+08:00' },
    { id: 'c2', name: 'Maria Santos', email: 'maria.santos@email.com', phone: '0918-234-5678', totalRentals: 3, joinedAt: '2025-06-20T08:00:00+08:00' },
    { id: 'c3', name: 'Carlo Reyes', email: 'carlo.reyes@email.com', phone: '0927-345-6789', totalRentals: 2, joinedAt: '2025-09-05T08:00:00+08:00' },
    { id: 'c4', name: 'Ana Villanueva', email: 'ana.v@email.com', phone: '0919-456-7890', totalRentals: 4, joinedAt: '2025-01-18T08:00:00+08:00' },
    { id: 'c5', name: 'Mark Bautista', email: 'mark.b@email.com', phone: '0920-567-8901', totalRentals: 1, joinedAt: '2026-02-10T08:00:00+08:00' }
  ];

  // Demo-focused reservations: include pending for admin review, approved without payment for customer upload, ongoing for start/complete flow context, etc.
  const reservations = [
    { id: 'r1', vehicleId: 'v1', customerId: 'c1', customerName: 'Juan Dela Cruz', customerEmail: 'juan.delacruz@email.com', start: day(1, 8), end: day(3, 18), actualReturn: null, status: 'pending', totalFee: 5400, overtimeFee: 0, createdAt: day(-1, 10), approvedBy: null, rejectReason: '' },
    { id: 'r2', vehicleId: 'v4', customerId: 'c2', customerName: 'Maria Santos', customerEmail: 'maria.santos@email.com', start: day(2, 9), end: day(4, 17), actualReturn: null, status: 'pending', totalFee: 4800, overtimeFee: 0, createdAt: day(0, 14), approvedBy: null, rejectReason: '' },
    { id: 'r3', vehicleId: 'v2', customerId: 'c3', customerName: 'Carlo Reyes', customerEmail: 'carlo.reyes@email.com', start: day(3, 8), end: day(4, 18), actualReturn: null, status: 'approved', totalFee: 1000, overtimeFee: 0, createdAt: day(-2, 9), approvedBy: 'Admin', rejectReason: '' },
    { id: 'r4', vehicleId: 'v6', customerId: 'c4', customerName: 'Ana Villanueva', customerEmail: 'ana.v@email.com', start: day(5, 8), end: day(7, 18), actualReturn: null, status: 'approved', totalFee: 6600, overtimeFee: 0, createdAt: day(-3, 11), approvedBy: 'Admin', rejectReason: '' },
    { id: 'r5', vehicleId: 'v3', customerId: 'c5', customerName: 'Mark Bautista', customerEmail: 'mark.b@email.com', start: day(-1, 8), end: day(1, 18), actualReturn: null, status: 'ongoing', totalFee: 1350, overtimeFee: 0, createdAt: day(-4, 15), approvedBy: 'Admin', rejectReason: '' },
    { id: 'r6', vehicleId: 'v1', customerId: 'c4', customerName: 'Ana Villanueva', customerEmail: 'ana.v@email.com', start: day(-10, 8), end: day(-8, 18), actualReturn: day(-8, 20), status: 'completed', totalFee: 5400, overtimeFee: 300, createdAt: day(-12, 9), approvedBy: 'Admin', rejectReason: '' },
    { id: 'r7', vehicleId: 'v8', customerId: 'c1', customerName: 'Juan Dela Cruz', customerEmail: 'juan.delacruz@email.com', start: day(-15, 8), end: day(-13, 18), actualReturn: day(-13, 18), status: 'completed', totalFee: 5100, overtimeFee: 0, createdAt: day(-17, 10), approvedBy: 'Admin', rejectReason: '' },
    { id: 'r8', vehicleId: 'v2', customerId: 'c2', customerName: 'Maria Santos', customerEmail: 'maria.santos@email.com', start: day(-6, 8), end: day(-5, 18), actualReturn: null, status: 'cancelled', totalFee: 1000, overtimeFee: 0, createdAt: day(-8, 13), approvedBy: null, rejectReason: '', cancelReason: 'Change of plans' },
    { id: 'r9', vehicleId: 'v4', customerId: 'c3', customerName: 'Carlo Reyes', customerEmail: 'carlo.reyes@email.com', start: day(-4, 8), end: day(-3, 18), actualReturn: null, status: 'rejected', totalFee: 3200, overtimeFee: 0, createdAt: day(-5, 16), approvedBy: 'Admin', rejectReason: 'Incomplete requirements submitted.' },
    { id: 'r10', vehicleId: 'v6', customerId: 'c1', customerName: 'Juan Dela Cruz', customerEmail: 'juan.delacruz@email.com', start: day(10, 8), end: day(12, 18), actualReturn: null, status: 'approved', totalFee: 6600, overtimeFee: 0, createdAt: day(-1, 8), approvedBy: 'Admin', rejectReason: '' }
  ];

  const payments = [
    { id: 'p1', reservationId: 'r4', method: 'GCash', amount: 6600, proofEmoji: '🧾', proofDataUrl: '', status: 'pending', submittedAt: day(-2, 12), verifiedBy: null, rejectReason: '' },
    { id: 'p2', reservationId: 'r10', method: 'GCash', amount: 6600, proofEmoji: '🧾', proofDataUrl: '', status: 'verified', submittedAt: day(-1, 9), verifiedBy: 'Admin', rejectReason: '' },
    { id: 'p3', reservationId: 'r6', method: 'GCash', amount: 5700, proofEmoji: '🧾', proofDataUrl: '', status: 'verified', submittedAt: day(-11, 10), verifiedBy: 'Admin', rejectReason: '' },
    { id: 'p4', reservationId: 'r7', method: 'Other', amount: 5100, proofEmoji: '🧾', proofDataUrl: '', status: 'verified', submittedAt: day(-16, 14), verifiedBy: 'Admin', rejectReason: '' },
    { id: 'p5', reservationId: 'r5', method: 'GCash', amount: 1350, proofEmoji: '🧾', proofDataUrl: '', status: 'verified', submittedAt: day(-3, 11), verifiedBy: 'Admin', rejectReason: '' },
    { id: 'p6', reservationId: 'r8', method: 'GCash', amount: 1000, proofEmoji: '🧾', proofDataUrl: '', status: 'rejected', submittedAt: day(-7, 15), verifiedBy: 'Admin', rejectReason: 'Reference number not readable.' }
  ];

  const maintenanceLogs = [
    { id: 'm1', vehicleId: 'v5', type: 'maintenance', title: 'Oil change and brake check', description: 'Routine preventive maintenance and brake pad inspection.', cost: 1200, status: 'open', reportedAt: day(-2, 9), resolvedAt: null },
    { id: 'm2', vehicleId: 'v7', type: 'incident', title: 'Engine misfire reported', description: 'Customer reported unusual vibration; unit pulled out for diagnostics.', cost: 0, status: 'open', reportedAt: day(-1, 16), resolvedAt: null },
    { id: 'm3', vehicleId: 'v1', type: 'maintenance', title: 'Tire rotation', description: 'Rotated tires and checked pressure.', cost: 500, status: 'resolved', reportedAt: day(-20, 10), resolvedAt: day(-19, 15) },
    { id: 'm4', vehicleId: 'v4', type: 'incident', title: 'Minor bumper scratch', description: 'Scratch noted after return; buffed and repainted.', cost: 2500, status: 'resolved', reportedAt: day(-12, 11), resolvedAt: day(-9, 14) },
    { id: 'm5', vehicleId: 'v2', type: 'maintenance', title: 'Chain lubrication', description: 'Lubricated chain and adjusted tension.', cost: 300, status: 'resolved', reportedAt: day(-14, 8), resolvedAt: day(-14, 12) },
    { id: 'm6', vehicleId: 'v6', type: 'incident', title: 'Aircon not cooling well', description: 'Inspected AC system and recharged freon.', cost: 1800, status: 'resolved', reportedAt: day(-30, 9), resolvedAt: day(-28, 16) }
  ];

  const notifications = [
    { id: 'n1', role: 'admin', title: 'New reservation request', body: 'Juan Dela Cruz requested Toyota Vios 1.3 E.', isRead: false, createdAt: day(-1, 10), link: '#/admin/reservations' },
    { id: 'n2', role: 'admin', title: 'New reservation request', body: 'Maria Santos requested Mitsubishi Mirage G4.', isRead: false, createdAt: day(0, 14), link: '#/admin/reservations' },
    { id: 'n3', role: 'admin', title: 'Payment proof submitted', body: 'Ana Villanueva submitted GCash proof for Toyota Avanza.', isRead: false, createdAt: day(-2, 12), link: '#/admin/payments' },
    { id: 'n4', role: 'admin', title: 'Maintenance logged', body: 'Honda TMX Supremo marked for maintenance.', isRead: true, createdAt: day(-2, 9), link: '#/admin/maintenance' },
    { id: 'n5', role: 'customer', title: 'Reservation approved', body: 'Your Honda Click 125i reservation was approved. Please upload payment proof.', isRead: false, createdAt: day(-2, 9), link: '#/customer/reservations' },
    { id: 'n6', role: 'customer', title: 'Reservation approved', body: 'Your Toyota Avanza reservation was approved. Please upload payment proof.', isRead: false, createdAt: day(-3, 11), link: '#/customer/reservations' },
    { id: 'n7', role: 'customer', title: 'Payment verified', body: 'Your payment for Kia Soluto has been verified.', isRead: true, createdAt: day(-16, 14), link: '#/customer/history' },
    { id: 'n8', role: 'customer', title: 'Reservation rejected', body: 'Your Mitsubishi Mirage G4 request was rejected. Check details for reason.', isRead: true, createdAt: day(-4, 8), link: '#/customer/reservations' }
  ];

  window.VERA_SEED = { vehicles, customers, reservations, payments, maintenanceLogs, notifications };

  window.VERA_STATE = {
    role: localStorage.getItem('vera_role') || null,
    currentCustomerId: 'c1', // demo customer
    vehicles: JSON.parse(JSON.stringify(vehicles)),
    customers: JSON.parse(JSON.stringify(customers)),
    reservations: JSON.parse(JSON.stringify(reservations)),
    payments: JSON.parse(JSON.stringify(payments)),
    maintenanceLogs: JSON.parse(JSON.stringify(maintenanceLogs)),
    notifications: JSON.parse(JSON.stringify(notifications)),
    ui: { notifOpen: false, modal: null }
  };
})();