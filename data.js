







// V.E.R.A. Seed Data & State
(function () {
  const today = new Date();
  // Generate demo dates in Philippine time, regardless of browser timezone.
  const day = (offset, hour = 8) => {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(today);
    const date = Object.fromEntries(parts.map(part => [part.type, part.value]));
    return new Date(Date.UTC(Number(date.year), Number(date.month) - 1,
      Number(date.day) + offset, hour - 8)).toISOString();
  };

  const vehicles = [
    {
        id: 'v1',
        imageUrl: 'images/vehicles/zx4rr-2026-front-angle.jpg',
        name: 'ZX-4RR',
        displacement: '400',
        brand: 'Kawasaki',
        model: 'ZX-4RR',
        year: 2026,
        plateNumber: 'NCR 1234',
        ratePerDay: 3500,
        ratePerHour: 150,
        status: 'available',
        imageEmoji: '🏍️',
        color: 'Green and Blue',
        seats: 2,
        transmission: 'Manual'
    },
    {
        id: 'v2',
        imageUrl: 'images/vehicles/zx4rr-2027-front-angle.jpg',
        name: 'ZX-4RR',
        displacement: '400',
        brand: 'Kawasaki',
        model: 'ZX-4RR',
        year: 2027,
        plateNumber: 'NCR 5678',
        ratePerDay: 3500,
        ratePerHour: 60,
        status: 'available',
        imageEmoji: '🏍️',
        color: 'Black',
        seats: 2,
        transmission: 'Manual'
    },
    {
        id: 'v3',
        imageUrl: 'images/vehicles/cb650r-front-angle.jpg',
        name: 'CB650R',
        displacement: '600',
        brand: 'Honda',
        model: 'CB650R',
        year: 2025,
        plateNumber: 'NCR 9012',
        ratePerDay: 3500,
        ratePerHour: 55,
        status: 'rented',
        imageEmoji: '🏍️',
        color: 'Black',
        seats: 2,
        transmission: 'Manual'
    },
    {
        id: 'v4',
        imageUrl: 'images/vehicles/zx6r-2025-front-angle.jpg',
        name: 'ZX-6R',
        displacement: '600',
        brand: 'Kawasaki',
        model: 'ZX-6R',
        year: 2025,
        plateNumber: 'NCR 3456',
        ratePerDay: 4300,
        ratePerHour: 140,
        status: 'available',
        imageEmoji: '🏍️',
        color: 'Black',
        seats: 2,
        transmission: 'Manual'
    },
    {
        id: 'v5',
        imageUrl: 'images/vehicles/cbr650r-front-angle.jpg',
        name: 'CBR650R',
        displacement: '600',
        brand: 'Honda',
        model: 'CBR650R',
        year: 2026,
        plateNumber: 'NCR 7890',
        ratePerDay: 4000,
        ratePerHour: 50,
        status: 'maintenance',
        imageEmoji: '🏍️',
        color: 'Grand Prix Red',
        seats: 2,
        transmission: 'Manual'
    },
    {
        id: 'v6',
        imageUrl: 'images/vehicles/z1100-se-front-angle.jpg',
        name: 'Z1100 SE',
        displacement: '1000',
        brand: 'Kawasaki',
        model: 'Z1100 SE',
        year: 2027,
        plateNumber: 'NCR 2468',
        ratePerDay: 4500,
        ratePerHour: 180,
        status: 'available',
        imageEmoji: '🏍️',
        color: 'SE Colorway',
        seats: 2,
        transmission: 'Manual'
    },
    {
        id: 'v7',
        imageUrl: 'images/vehicles/zx10r-2025-front-angle.jpg',
        name: 'ZX-10R',
        displacement: '1000',
        brand: 'Kawasaki',
        model: 'ZX-10R',
        year: 2025,
        plateNumber: 'NCR 1357',
        ratePerDay: 6500,
        ratePerHour: 65,
        status: 'malfunction',
        imageEmoji: '🏍️',
        color: 'Green, Yellow and White',
        seats: 2,
        transmission: 'Manual'
    }
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
    { id: 'r1', vehicleId: 'v1', customerId: 'c1', customerName: 'Juan Dela Cruz', customerEmail: 'juan.delacruz@email.com', start: day(1, 8), end: day(3, 18), actualReturn: null, status: 'pending', totalFee: 5400, overtimeFee: 0, createdAt: day(-1, 10), approvedBy: null, rejectReason: '', deliveryMethod: 'Guest Pickup & Guest Return' },
    { id: 'r2', vehicleId: 'v4', customerId: 'c2', customerName: 'Maria Santos', customerEmail: 'maria.santos@email.com', start: day(2, 9), end: day(4, 17), actualReturn: null, status: 'pending', totalFee: 4800, overtimeFee: 0, createdAt: day(0, 14), approvedBy: null, rejectReason: '', deliveryMethod: 'Guest Pickup & Host Collection' },
    { id: 'r3', vehicleId: 'v2', customerId: 'c3', customerName: 'Carlo Reyes', customerEmail: 'carlo.reyes@email.com', start: day(3, 8), end: day(4, 18), actualReturn: null, status: 'approved', totalFee: 1000, overtimeFee: 0, createdAt: day(-2, 9), approvedBy: 'Admin', rejectReason: '', deliveryMethod: 'Host Delivery & Guest Return' },
    { id: 'r4', vehicleId: 'v6', customerId: 'c4', customerName: 'Ana Villanueva', customerEmail: 'ana.v@email.com', start: day(5, 8), end: day(7, 18), actualReturn: null, status: 'approved', totalFee: 6600, overtimeFee: 0, createdAt: day(-3, 11), approvedBy: 'Admin', rejectReason: '', deliveryMethod: 'Host Delivery & Host Collection' },
    { id: 'r5', vehicleId: 'v3', customerId: 'c5', customerName: 'Mark Bautista', customerEmail: 'mark.b@email.com', start: day(-1, 8), end: day(1, 18), actualReturn: null, status: 'ongoing', totalFee: 1350, overtimeFee: 0, createdAt: day(-4, 15), approvedBy: 'Admin', rejectReason: '', deliveryMethod: 'Guest Pickup & Guest Return' },
    { id: 'r6', vehicleId: 'v1', customerId: 'c4', customerName: 'Ana Villanueva', customerEmail: 'ana.v@email.com', start: day(-10, 8), end: day(-8, 18), actualReturn: day(-8, 20), status: 'completed', totalFee: 5400, overtimeFee: 300, createdAt: day(-12, 9), approvedBy: 'Admin', rejectReason: '', deliveryMethod: 'Guest Pickup & Host Collection' },
    { id: 'r7', vehicleId: 'v7', customerId: 'c1', customerName: 'Juan Dela Cruz', customerEmail: 'juan.delacruz@email.com', start: day(-15, 8), end: day(-13, 18), actualReturn: day(-13, 18), status: 'completed', totalFee: 5100, overtimeFee: 0, createdAt: day(-17, 10), approvedBy: 'Admin', rejectReason: '', deliveryMethod: 'Host Delivery & Guest Return' },
    { id: 'r8', vehicleId: 'v2', customerId: 'c2', customerName: 'Maria Santos', customerEmail: 'maria.santos@email.com', start: day(-6, 8), end: day(-5, 18), actualReturn: null, status: 'cancelled', totalFee: 1000, overtimeFee: 0, createdAt: day(-8, 13), approvedBy: null, rejectReason: '', cancelReason: 'Change of plans', deliveryMethod: 'Host Delivery & Host Collection' },
    { id: 'r9', vehicleId: 'v4', customerId: 'c3', customerName: 'Carlo Reyes', customerEmail: 'carlo.reyes@email.com', start: day(-4, 8), end: day(-3, 18), actualReturn: null, status: 'rejected', totalFee: 3200, overtimeFee: 0, createdAt: day(-5, 16), approvedBy: 'Admin', rejectReason: 'Incomplete requirements submitted.', deliveryMethod: 'Guest Pickup & Guest Return' },
    { id: 'r10', vehicleId: 'v6', customerId: 'c1', customerName: 'Juan Dela Cruz', customerEmail: 'juan.delacruz@email.com', start: day(10, 8), end: day(12, 18), actualReturn: null, status: 'approved', totalFee: 6600, overtimeFee: 0, createdAt: day(-1, 8), approvedBy: 'Admin', rejectReason: '', deliveryMethod: 'Host Delivery & Guest Return' }
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
    { id: 'm3', vehicleId: 'v1', type: 'maintenance', title: 'Tire inspection', description: 'Inspected tire wear and checked pressure.', cost: 500, status: 'resolved', reportedAt: day(-20, 10), resolvedAt: day(-19, 15) },
    { id: 'm4', vehicleId: 'v4', type: 'incident', title: 'Minor fairing scratch', description: 'Scratch noted after return; buffed and repainted.', cost: 2500, status: 'resolved', reportedAt: day(-12, 11), resolvedAt: day(-9, 14) },
    { id: 'm5', vehicleId: 'v2', type: 'maintenance', title: 'Chain lubrication', description: 'Lubricated chain and adjusted tension.', cost: 300, status: 'resolved', reportedAt: day(-14, 8), resolvedAt: day(-14, 12) },
    { id: 'm6', vehicleId: 'v6', type: 'incident', title: 'Cooling system inspection', description: 'Inspected coolant level and cooling system.', cost: 1800, status: 'resolved', reportedAt: day(-30, 9), resolvedAt: day(-28, 16) }
  ];

  const notifications = [
    { id: 'n1', role: 'admin', title: 'New reservation request', body: 'Juan Dela Cruz requested ZX-4RR.', isRead: false, createdAt: day(-1, 10), link: '#/admin/reservations' },
    { id: 'n2', role: 'admin', title: 'New reservation request', body: 'Maria Santos requested ZX-6R.', isRead: false, createdAt: day(0, 14), link: '#/admin/reservations' },
    { id: 'n3', role: 'admin', title: 'Payment proof submitted', body: 'Ana Villanueva submitted GCash proof for Z1100.', isRead: false, createdAt: day(-2, 12), link: '#/admin/payments' },
    { id: 'n4', role: 'admin', title: 'Maintenance logged', body: 'CBR650R marked for maintenance.', isRead: true, createdAt: day(-2, 9), link: '#/admin/maintenance' },
    { id: 'n5', role: 'customer', title: 'Reservation approved', body: 'Your ZX-4RR reservation was approved. Please upload payment proof.', isRead: false, createdAt: day(-2, 9), link: '#/customer/reservations' },
    { id: 'n6', role: 'customer', title: 'Reservation approved', body: 'Your Z1100 reservation was approved. Please upload payment proof.', isRead: false, createdAt: day(-3, 11), link: '#/customer/reservations' },
    { id: 'n7', role: 'customer', title: 'Payment verified', body: 'Your payment for ZX-10R has been verified.', isRead: true, createdAt: day(-16, 14), link: '#/customer/history' },
    { id: 'n8', role: 'customer', title: 'Reservation rejected', body: 'Your ZX-6R request was rejected. Check details for reason.', isRead: true, createdAt: day(-4, 8), link: '#/customer/reservations' }
  ];

  // Recalculate synthetic demo records using the current daily and overtime rates.
  // Do not use this routine to reprice real historical transactions.
  for (const reservation of reservations) {
    const vehicle = vehicles.find(item => item.id === reservation.vehicleId);
    const duration = new Date(reservation.end) - new Date(reservation.start);
    reservation.refund = null;
    reservation.totalFee = Math.ceil(duration / 86400000) * vehicle.ratePerDay;
    const overtime = reservation.actualReturn
      ? Math.max(0, new Date(reservation.actualReturn) - new Date(reservation.end))
      : 0;
    reservation.overtimeFee = Math.ceil(overtime / 3600000) * vehicle.ratePerHour;
  }

  for (const payment of payments) {
    const reservation = reservations.find(item => item.id === payment.reservationId);
    payment.paymentType = 'rental';
    payment.amount = reservation.totalFee;
  }

  // Split historically settled demo overtime from the original rental payment.
  for (const reservation of reservations) {
    if (!reservation.overtimeFee) continue;
    const vehicle = vehicles.find(v => v.id === reservation.vehicleId);
    const original = payments.find(p => p.reservationId === reservation.id && p.status === 'verified');
    reservation.overtime = {
      hours: Math.ceil((new Date(reservation.actualReturn) - new Date(reservation.end)) / 3600000),
      ratePerHour: vehicle.ratePerHour, calculatedFee: reservation.overtimeFee,
      finalFee: reservation.overtimeFee, adjustmentReason: '', assessedBy: 'Admin',
      assessedAt: reservation.actualReturn, paymentStatus: original ? 'paid' : 'unpaid'
    };
    if (original) payments.push({ ...original, id: original.id + '-ot', paymentType: 'overtime', amount: reservation.overtimeFee, submittedAt: reservation.actualReturn });
  }

  // Fictional refund scenarios for prototype demonstrations.
  const refundExamples = [
    { id:'r11', vehicleId:'v2', customerId:'c1', start:day(-45,8), end:day(-41,8), actualReturn:day(-43,8), status:'completed', reasonType:'early_return', reasonNotes:'Customer voluntarily returned two days early.', unusedDays:2, gross:7000, deduction:1000, amount:6000, refundStatus:'pending' },
    { id:'r12', vehicleId:'v4', customerId:'c2', start:day(-38,8), end:day(-35,8), actualReturn:day(-37,8), status:'completed', reasonType:'vehicle_defect', reasonNotes:'Inspection confirmed a pre-existing mechanical issue; no customer fault.', unusedDays:2, gross:8600, deduction:0, amount:8600, refundStatus:'disbursed' },
    { id:'r13', vehicleId:'v6', customerId:'c3', start:day(-31,8), end:day(-29,8), actualReturn:null, status:'cancelled', reasonType:'business_cancellation', reasonNotes:'Business cancelled before pickup because the motorcycle was unavailable.', amount:9000, refundStatus:'received' },
    { id:'r14', vehicleId:'v1', customerId:'c4', start:day(-25,8), end:day(-23,8), actualReturn:day(-23,8), status:'completed', reasonType:'service_issue', reasonNotes:'Partial goodwill refund for a documented delivery delay.', amount:1000, refundStatus:'pending' }
  ];
  for (const ex of refundExamples) {
    const c = customers.find(c => c.id === ex.customerId), v = vehicles.find(v => v.id === ex.vehicleId);
    const totalFee = Math.ceil((new Date(ex.end)-new Date(ex.start))/86400000)*v.ratePerDay;
    const assessedAt = ex.actualReturn || day(-32,8);
    const refund = {reasonType:ex.reasonType, reasonNotes:ex.reasonNotes, unusedDays:ex.unusedDays, gross:ex.gross, deduction:ex.deduction, amount:ex.amount, paid:totalFee, status:ex.refundStatus, assessedAt, assessedBy:'Admin'};
    if (ex.refundStatus !== 'pending') Object.assign(refund,{method:'GCash',referenceNumber:'DEMO-'+ex.id.toUpperCase(),refundedAt:assessedAt,refundedBy:'Admin'});
    if (ex.refundStatus === 'received') refund.receivedAt = assessedAt;
    reservations.push({id:ex.id,vehicleId:v.id,customerId:c.id,customerName:c.name,customerEmail:c.email,start:ex.start,end:ex.end,actualReturn:ex.actualReturn,status:ex.status,totalFee,overtimeFee:0,createdAt:new Date(new Date(ex.start).getTime()-3*86400000).toISOString(),approvedBy:'Admin',rejectReason:'',cancelReason:ex.status==='cancelled'?ex.reasonNotes:'',deliveryMethod:'Guest Pickup & Guest Return',refund});
    payments.push({id:'p-'+ex.id,reservationId:ex.id,paymentType:'rental',method:'GCash',amount:totalFee,proofDataUrl:'',status:'verified',submittedAt:new Date(new Date(ex.start).getTime()-4*3600000).toISOString(),verifiedBy:'Admin',rejectReason:''});
  }

  // Demo customer identity records: no actual identification documents are seeded.
  for (const customer of customers) {
    customer.profileImage = '';
    customer.identification = {
      idType: '', idNumber: '', idImage: '', licenseNumber: '',
      licenseExpiry: '', licenseFront: '', licenseBack: '',
      verificationStatus: 'not_submitted', verifiedBy: null,
      verifiedAt: null, rejectionReason: ''
    };
  }

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
    activityLogs: [],
    ui: { notifOpen: false, modal: null }
  };
})();




