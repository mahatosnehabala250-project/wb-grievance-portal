import { PrismaClient } from '@prisma/client';
import { hashSync } from 'bcryptjs';

const db = new PrismaClient();

const DISTRICTS = ['Nadia', 'Purulia', 'Bankura', 'Murshidabad', 'Birbhum'];

const BLOCKS: Record<string, string[]> = {
  Nadia: ['Krishnanagar', 'Ranaghat', 'Kalyani', 'Shantipur', 'Chakdaha', 'Haringhata'],
  Purulia: ['Purulia Sadar', 'Raghunathpur', 'Jhalda', 'Bakura', 'Balarampur', 'Hura'],
  Bankura: ['Bankura Sadar', 'Bishnupur', 'Khatra', 'Ranibandh', 'Indpur', 'Chhatna'],
  Murshidabad: ['Berhampore', 'Baharampur', 'Jangipur', 'Lalgola', 'Domkal', 'Hariharpara'],
  Birbhum: ['Suri', 'Bolpur', 'Rampurhat', 'Sainthia', 'Nalhati', 'Dubrajpur'],
};

const CATEGORIES = ['Water Supply', 'Road Damage', 'Electricity', 'Sanitation', 'Healthcare', 'Education', 'Agriculture', 'Public Transport'];
const NAMES = [
  'Amit Das', 'Priya Ghosh', 'Rajesh Sarkar', 'Sunita Mondal', 'Bikas Roy',
  'Tapasi Biswas', 'Sanjay Haldar', 'Mita Pal', 'Kartik Das', 'Ruma Khatun',
  'Debashis Adhikari', 'Anjana Dey', 'Swarup Bag', 'Nasreen Begam', 'Pranab Maitra',
  'Chaitali Saha', 'Nikhil Ghosh', 'Rashmi Barman', 'Subrata Sinha', 'Papiya Dolui',
  'Arup Burman', 'Lakshmi Purkait', 'Manik Bala', 'Shyamal Das', 'Kakoli Sen',
];
const STATUSES = ['OPEN', 'IN_PROGRESS', 'RESOLVED'];
const STATUS_WEIGHTS = [0.4, 0.3, 0.3];
const URGENCIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
const URGENCY_WEIGHTS = [0.2, 0.4, 0.25, 0.15];

function pick<T>(arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)]; }
function weightedPick<T>(items: T[], weights: number[]): T {
  const r = Math.random();
  let sum = 0;
  for (let i = 0; i < items.length; i++) { sum += weights[i]; if (r <= sum) return items[i]; }
  return items[items.length - 1];
}
function randomPhone() { return `9${Math.floor(Math.random() * 9000000000 + 100000000)}`; }
function daysAgo(n: number) { const d = new Date(); d.setDate(d.getDate() - n); return d; }
function pad2(n: number) { return String(n).padStart(2, '0'); }

function genTicketNo(idx: number) { return `WB-${String(1000 + idx).padStart(5, '0')}`; }

function genDescription(category: string, block: string, district: string) {
  const descs: Record<string, string[]> = {
    'Water Supply': [
      `No water supply for the past 3 days in ${block}, ${district}. Residents are forced to buy water from private tankers.`,
      `Contaminated water being supplied through municipal pipes. Several children have fallen ill in ${block}.`,
      `Low water pressure in the upper floors of residential buildings in ${block} area.`,
    ],
    'Road Damage': [
      `Major pothole on the main road connecting ${block} to the district headquarters. Accidents occur daily.`,
      `Road completely washed away after recent floods in ${block}. School buses cannot reach the village.`,
      `Multiple potholes filled with stagnant water causing dengue risk in ${block} area.`,
    ],
    'Electricity': [
      `Frequent power cuts (8-10 hours daily) in ${block} disrupting daily life and business.`,
      `Electric pole leaning dangerously near the primary school in ${block}. Risk of electrocution.`,
      `No electricity connection for the newly constructed houses under PM Awas Yojana in ${block}.`,
    ],
    'Sanitation': [
      `Open drainage near residential area causing foul smell and mosquito breeding in ${block}.`,
      `No garbage collection service for the past month in ${block}. Waste piling up on streets.`,
      `Broken public toilet in the market area of ${block}. Women and elderly face difficulties.`,
    ],
    'Healthcare': [
      `Primary Health Center in ${block} has no doctor. Only one nurse available for 5000+ patients.`,
      `Medicines not available at government hospital in ${block}. Patients forced to buy from private stores.`,
      `Ambulance service not available in ${block}. Emergency patients die due to delayed transport.`,
    ],
    'Education': [
      `Government school building in ${block} has cracks and is unsafe for children. Roof may collapse.`,
      `No teachers posted at the primary school in ${block} for the past 6 months.`,
      `No computer or internet facility at the government school in ${block} despite digital education mandate.`,
    ],
    'Agriculture': [
      `Farmers in ${block} not receiving subsidized fertilizer. Supply chain is disrupted.`,
      `Canal irrigation system blocked. Crops dying due to water shortage in ${block}.`,
      `Pest attack on paddy crops in ${block}. No agricultural officer has visited to assess the damage.`,
    ],
    'Public Transport': [
      `Bus service stopped on the ${block}-district route. Commuters forced to pay high auto fares.`,
      `No bus shelter on the main road in ${block}. Passengers suffer in extreme heat and rain.`,
      `Overcrowded buses on the ${block} route. Safety of women passengers is a concern.`,
    ],
  };
  return pick(descs[category] || [`Issue regarding ${category} reported from ${block}, ${district}. Needs immediate attention.`]);
}

async function seed() {
  console.log('🌱 Seeding database...\n');

  // Clean existing
  await db.complaint.deleteMany();
  await db.user.deleteMany();

  // ─── USERS ───
  const users = [
    // Admin
    { username: 'admin', password: 'admin123', role: 'ADMIN', name: 'System Administrator', location: 'West Bengal', district: null },
    // State Level
    { username: 'state_wb', password: 'state123', role: 'STATE', name: 'Arun Kumar Sharma', location: 'West Bengal', district: null },
    // District Level
    { username: 'district_nadia', password: 'nadia123', role: 'DISTRICT', name: 'Dr. Sujata Mukherjee', location: 'Nadia', district: 'Nadia' },
    { username: 'district_purulia', password: 'purulia123', role: 'DISTRICT', name: 'Rabindra Nath Maity', location: 'Purulia', district: 'Purulia' },
    { username: 'district_bankura', password: 'bankura123', role: 'DISTRICT', name: 'Tanmoy Ghosh', location: 'Bankura', district: 'Bankura' },
    // Block Level
    { username: 'block_krishnanagar', password: 'krish123', role: 'BLOCK', name: 'Bipul Das', location: 'Krishnanagar', district: 'Nadia' },
    { username: 'block_ranaghat', password: 'rana123', role: 'BLOCK', name: 'Mita Rani Sarkar', location: 'Ranaghat', district: 'Nadia' },
    { username: 'block_kalyani', password: 'kalyani123', role: 'BLOCK', name: 'Sunil Karmakar', location: 'Kalyani', district: 'Nadia' },
    { username: 'block_purulia_sadar', password: 'psadar123', role: 'BLOCK', name: 'Amiya Mahato', location: 'Purulia Sadar', district: 'Purulia' },
    { username: 'block_raghunathpur', password: 'raghunath123', role: 'BLOCK', name: 'Sujit Tudu', location: 'Raghunathpur', district: 'Purulia' },
    { username: 'block_bankura_sadar', password: 'bsadar123', role: 'BLOCK', name: 'Prasanta Mondal', location: 'Bankura Sadar', district: 'Bankura' },
    { username: 'block_bishnupur', password: 'bishnu123', role: 'BLOCK', name: 'Anita Dhibar', location: 'Bishnupur', district: 'Bankura' },
  ];

  for (const u of users) {
    const { password: _, ...userData } = u;
    await db.user.create({
      data: { ...userData, passwordHash: hashSync(u.password, 12) },
    });
  }
  console.log(`✅ Created ${users.length} users`);

  // ─── COMPLAINTS ───
  const complaints: { ticketNo: string; citizenName: string; phone: string; issue: string; category: string; block: string; district: string; urgency: string; status: string; description: string; createdAt: Date; source: string; }[] = [];

  let ticketIdx = 0;
  for (const district of DISTRICTS) {
    for (const block of BLOCKS[district]) {
      // Generate 4-8 complaints per block
      const count = 4 + Math.floor(Math.random() * 5);
      for (let i = 0; i < count; i++) {
        const daysBack = Math.random() < 0.1 ? 0 : Math.floor(Math.random() * 120);
        const category = pick(CATEGORIES);
        const urgency = weightedPick(URGENCIES, URGENCY_WEIGHTS);
        const status = weightedPick(STATUSES, STATUS_WEIGHTS);
        const source = Math.random() < 0.85 ? 'WHATSAPP' : 'MANUAL';

        complaints.push({
          ticketNo: genTicketNo(ticketIdx++),
          citizenName: pick(NAMES),
          phone: randomPhone(),
          issue: `${category} issue in ${block}`,
          category,
          block,
          district,
          urgency,
          status,
          description: genDescription(category, block, district),
          createdAt: daysAgo(daysBack),
          source,
        });
      }
    }
  }

  // Also add some resolved complaints with resolution text
  for (let i = 0; i < complaints.length; i++) {
    if (complaints[i].status === 'RESOLVED') {
      const resolutions = [
        'Issue resolved. Water supply restored after pipe repair.',
        'Road patched and repaired by PWD department.',
        'Electric connection restored after transformer replacement.',
        'Drainage cleaned and repaired by municipal workers.',
        'Doctor posted at PHC. Medicine supply restored.',
        'Teacher posted. Classes resumed normally.',
        'Fertilizer distributed through cooperative society.',
        'Bus service resumed with new vehicles.',
      ];
      complaints[i] = { ...complaints[i], resolution: pick(resolutions) };
    }
  }

  // Batch insert
  for (const c of complaints) {
    await db.complaint.create({ data: c });
  }

  console.log(`✅ Created ${complaints.length} complaints across ${DISTRICTS.length} districts`);

  const totalCount = await db.complaint.count();
  const districtCount = await db.user.count({ where: { role: 'DISTRICT' } });
  const blockCount = await db.user.count({ where: { role: 'BLOCK' } });
  console.log(`\n📊 Summary:`);
  console.log(`   Total Complaints: ${totalCount}`);
  console.log(`   District Users: ${districtCount}`);
  console.log(`   Block Users: ${blockCount}`);
  console.log(`\n🔐 Test Credentials:`);
  console.log(`   Admin:    admin / admin123`);
  console.log(`   State:    state_wb / state123`);
  console.log(`   District: district_nadia / nadia123`);
  console.log(`   Block:    block_krishnanagar / krish123`);
}

seed()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => db.$disconnect());
